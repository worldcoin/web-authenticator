import {
  SIMULATION_ENVIRONMENT,
  bytesToArrayBuffer,
  bytesToBase64Url,
  type StagingEd25519TrustRootV0,
} from "@clean-start/contracts";

export interface PurposeEd25519KeyV0 {
  readonly keyId: string;
  readonly audience: string;
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  readonly publicKeyRawBase64Url: string;
  readonly publicKeyFingerprintHex: string;
  readonly trustRoot: StagingEd25519TrustRootV0;
  sign(bytes: Uint8Array): Promise<string>;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createPurposeEd25519KeyV0(
  keyId: string,
  audience: string,
): Promise<PurposeEd25519KeyV0> {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const publicKeyRawBase64Url = bytesToBase64Url(publicBytes);
  const trustRoot: StagingEd25519TrustRootV0 = Object.freeze({
    environment: SIMULATION_ENVIRONMENT,
    audience,
    keyId,
    publicKeyRawBase64Url,
  });

  return Object.freeze({
    keyId,
    audience,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyRawBase64Url,
    publicKeyFingerprintHex: hex(publicBytes),
    trustRoot,
    async sign(bytes: Uint8Array): Promise<string> {
      const signature = await crypto.subtle.sign(
        { name: "Ed25519" },
        pair.privateKey,
        bytesToArrayBuffer(bytes),
      );
      return bytesToBase64Url(new Uint8Array(signature));
    },
  });
}

export async function createSessionHandleHmacKeyV0(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

export function assertPurposeKeySeparationV0(
  keys: readonly PurposeEd25519KeyV0[],
  handleKey: CryptoKey,
): void {
  if (
    keys.length !== 5 ||
    new Set(keys.map((key) => key.keyId)).size !== 5 ||
    new Set(keys.map((key) => key.publicKeyFingerprintHex)).size !== 5 ||
    keys.some((key) =>
      key.privateKey.algorithm.name !== "Ed25519" ||
      !key.privateKey.usages.includes("sign") ||
      key.publicKey.algorithm.name !== "Ed25519" ||
      !key.publicKey.usages.includes("verify")
    ) ||
    handleKey.algorithm.name !== "HMAC" ||
    handleKey.extractable ||
    !handleKey.usages.includes("sign") ||
    !handleKey.usages.includes("verify")
  ) {
    throw new TypeError("purpose_key_separation_failed");
  }
}
