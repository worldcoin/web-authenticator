import type { ProtocolEnvironment } from "../../config/environment";
import { openEnrollmentSecrets, sealEnrollmentSecrets, type EnrollmentSecrets } from "./enrollment-secrets";
import { isSharedRpId } from "./passkey-rp";
import { WalletOpenError } from "./wallet-errors";

/**
 * The saved-wallet record: the only format "Save with passkey" writes.
 *
 * Wallet secrets are random (created at enrollment, before any passkey exists), so the passkey
 * cannot derive them. It protects them instead: PRF output → HKDF → wrapping key → AES-GCM over
 * the secrets. Everything stored here is public metadata or ciphertext; the wrapping key and the
 * PRF output are never persisted.
 */
export interface SavedWallet {
  readonly version: 2;
  /** Hex passkey credential ID that unlocks this wallet. */
  readonly credentialId: string;
  /** RP ID the passkey was created under; absent means this page's hostname. */
  readonly rpId?: string;
  readonly environment: ProtocolEnvironment;
  /** WalletKit OPFS root of the vault that `databaseKey` opens. */
  readonly storageId: string;
  /** base64url `sealEnrollmentSecrets` envelope, bound to the fields above. */
  readonly encryptedSecrets: string;
}

export type SavedWalletMetadata = Omit<SavedWallet, "version" | "encryptedSecrets">;

export type SavedWalletFailure = "invalid_record" | "decrypt_failed";

/** UI-safe failure with a stable reason for telemetry. Never carries secret material. */
export class SavedWalletError extends WalletOpenError {
  constructor(message: string, readonly reason: SavedWalletFailure, options?: ErrorOptions) {
    super(message, options);
  }
}

/** Contract labels. Changing any of them makes every saved wallet unreadable. */
export const SAVED_WALLET_BINDING_LABEL = "world-id/web-authenticator/saved-wallet/v2";
const WRAP_SALT = new TextEncoder().encode("world-id/web-authenticator/keys/v1");
const WRAP_INFO = new TextEncoder().encode("wallet-secrets-wrap/v1");

/** Length of a version-1 `sealEnrollmentSecrets` envelope: 13-byte header, 128-byte body, 16-byte tag. */
export const SEALED_SECRETS_BYTES = 157;

const CREDENTIAL_ID = /^(?:[0-9a-f]{2}){1,1024}$/;
const STORAGE_ID = /^\/walletkit\/enrollment-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const INVALID = "Saved wallet metadata is invalid. Do not clear site data if you need this wallet.";
const UNREADABLE = "This passkey could not unlock the saved wallet. Use the passkey you saved it with, and do not clear site data.";

/**
 * Derives the key that wraps the wallet secrets from the passkey's 32-byte PRF output.
 * Its HKDF `info` differs from every other key derived from the same output. The caller zeroes `prf`.
 */
export async function deriveWrappingKey(prf: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (prf.byteLength !== 32) throw new WalletOpenError("The passkey returned invalid PRF output.");
  const material = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: WRAP_SALT, info: WRAP_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The AES-GCM additional data. Decryption succeeds only with the exact metadata the secrets
 * were sealed under, so an edited or copied record fails instead of opening another vault.
 */
export function savedWalletBinding(metadata: SavedWalletMetadata): string {
  return JSON.stringify([
    SAVED_WALLET_BINDING_LABEL,
    metadata.credentialId,
    metadata.rpId ?? null,
    metadata.environment,
    metadata.storageId,
  ]);
}

export async function sealSavedWallet(secrets: EnrollmentSecrets, key: CryptoKey, metadata: SavedWalletMetadata): Promise<SavedWallet> {
  const checked = checkMetadata(metadata);
  const envelope = await sealEnrollmentSecrets(secrets, key, savedWalletBinding(checked));
  return { version: 2, ...checked, encryptedSecrets: toBase64Url(envelope) };
}

/** The caller owns the returned secrets and must `clearEnrollmentSecrets` them. */
export async function openSavedWallet(record: SavedWallet, key: CryptoKey): Promise<EnrollmentSecrets> {
  const checked = checkRecord(record);
  try {
    return await openEnrollmentSecrets(fromBase64Url(checked.encryptedSecrets), key, savedWalletBinding(checked));
  } catch (cause) {
    throw new SavedWalletError(UNREADABLE, "decrypt_failed", { cause });
  }
}

export function serializeSavedWallet(record: SavedWallet): string {
  const checked = checkRecord(record);
  return JSON.stringify({
    version: 2,
    credentialId: checked.credentialId,
    ...(checked.rpId === undefined ? {} : { rpId: checked.rpId }),
    environment: checked.environment,
    storageId: checked.storageId,
    encryptedSecrets: checked.encryptedSecrets,
  });
}

/** Strict parse; unknown fields are dropped. */
export function parseSavedWallet(raw: string): SavedWallet {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (cause) { throw new SavedWalletError(INVALID, "invalid_record", { cause }); }
  if (typeof value !== "object" || value === null) throw new SavedWalletError(INVALID, "invalid_record");
  return checkRecord(value as Partial<Record<keyof SavedWallet, unknown>>);
}

function checkMetadata(value: Partial<Record<keyof SavedWalletMetadata, unknown>>): SavedWalletMetadata {
  const { credentialId, rpId, environment, storageId } = value;
  if (
    typeof credentialId !== "string" || !CREDENTIAL_ID.test(credentialId) ||
    (rpId !== undefined && !isSharedRpId(rpId)) ||
    (environment !== "staging" && environment !== "production") ||
    typeof storageId !== "string" || !STORAGE_ID.test(storageId)
  ) throw new SavedWalletError(INVALID, "invalid_record");
  return rpId === undefined ? { credentialId, environment, storageId } : { credentialId, rpId, environment, storageId };
}

function checkRecord(value: Partial<Record<keyof SavedWallet, unknown>>): SavedWallet {
  const { version, encryptedSecrets } = value;
  if (
    version !== 2 ||
    typeof encryptedSecrets !== "string" || !BASE64URL.test(encryptedSecrets) ||
    fromBase64Url(encryptedSecrets).byteLength !== SEALED_SECRETS_BYTES
  ) throw new SavedWalletError(INVALID, "invalid_record");
  return { version: 2, ...checkMetadata(value), encryptedSecrets };
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 4 === 1) throw new SavedWalletError(INVALID, "invalid_record");
  let binary: string;
  try { binary = atob(text.replace(/-/g, "+").replace(/_/g, "/")); }
  catch (cause) { throw new SavedWalletError(INVALID, "invalid_record", { cause }); }
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
