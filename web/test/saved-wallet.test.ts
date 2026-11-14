import { describe, expect, test } from "bun:test";
import { clearEnrollmentSecrets, createEnrollmentSecrets, sealEnrollmentSecrets } from "../lib/enrollment-secrets";
import {
  deriveWrappingKey, openSavedWallet, parseSavedWallet, savedWalletBinding, sealSavedWallet,
  SEALED_SECRETS_BYTES, serializeSavedWallet, SavedWalletError, type SavedWallet, type SavedWalletMetadata,
} from "../lib/saved-wallet";
import { deriveWalletKeys } from "../lib/wallet-session";

const metadata: SavedWalletMetadata = {
  credentialId: "a1b2c3d4",
  rpId: "auth.worldcoin.dev",
  environment: "staging",
  storageId: "/walletkit/enrollment-1b4e28ba-2fa1-4d2b-883f-0016d3cca427",
};
const prf = () => new Uint8Array(32).fill(7);

async function failure(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) {
    expect(error).toBeInstanceOf(SavedWalletError);
    return (error as SavedWalletError).reason;
  }
  throw new Error("expected a SavedWalletError");
}

function reason(run: () => unknown): string {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(SavedWalletError);
    return (error as SavedWalletError).reason;
  }
  throw new Error("expected a SavedWalletError");
}

describe("saved-wallet record", () => {
  test("save then reopen with the same passkey restores the original secrets", async () => {
    const secrets = await createEnrollmentSecrets();
    try {
      const record = await sealSavedWallet(secrets, await deriveWrappingKey(prf()), metadata);
      const stored = parseSavedWallet(serializeSavedWallet(record));
      expect(stored).toEqual(record);
      // Reopening derives the wrapping key again from a fresh PRF evaluation.
      const restored = await openSavedWallet(stored, await deriveWrappingKey(prf()));
      expect(restored).toEqual(secrets);
      clearEnrollmentSecrets(restored);
    } finally { clearEnrollmentSecrets(secrets); }
  });

  test("a different passkey cannot open it", async () => {
    const secrets = await createEnrollmentSecrets();
    try {
      const record = await sealSavedWallet(secrets, await deriveWrappingKey(prf()), metadata);
      const other = await deriveWrappingKey(new Uint8Array(32).fill(8));
      expect(await failure(openSavedWallet(record, other))).toBe("decrypt_failed");
    } finally { clearEnrollmentSecrets(secrets); }
  });

  test("changing any bound field makes decryption fail instead of opening another vault", async () => {
    const secrets = await createEnrollmentSecrets();
    const key = await deriveWrappingKey(prf());
    try {
      const record = await sealSavedWallet(secrets, key, metadata);
      const { rpId: _, ...withoutRpId } = record;
      const tampered: SavedWallet[] = [
        { ...record, credentialId: "a1b2c3d5" },
        { ...record, rpId: "auth.world.org" },
        withoutRpId,
        { ...record, environment: "production" },
        { ...record, storageId: "/walletkit/enrollment-2b4e28ba-2fa1-4d2b-883f-0016d3cca427" },
      ];
      for (const candidate of tampered) {
        expect(await failure(openSavedWallet(candidate, key))).toBe("decrypt_failed");
      }
    } finally { clearEnrollmentSecrets(secrets); }
  });

  test("records without an RP ID (page-hostname passkeys) round-trip", async () => {
    const secrets = await createEnrollmentSecrets();
    const key = await deriveWrappingKey(prf());
    try {
      const { rpId: _, ...hostname } = metadata;
      const record = await sealSavedWallet(secrets, key, hostname);
      expect("rpId" in record).toBe(false);
      const restored = await openSavedWallet(parseSavedWallet(serializeSavedWallet(record)), key);
      expect(restored).toEqual(secrets);
      clearEnrollmentSecrets(restored);
    } finally { clearEnrollmentSecrets(secrets); }
  });

  test("malformed records are rejected as invalid, never treated as absent", async () => {
    const secrets = await createEnrollmentSecrets();
    try {
      const valid = JSON.parse(serializeSavedWallet(await sealSavedWallet(secrets, await deriveWrappingKey(prf()), metadata)));
      const cases: unknown[] = [
        "{", "null", "[]", {},
        { ...valid, version: 1 },
        { ...valid, credentialId: "A1B2" },
        { ...valid, credentialId: "abc" },
        { ...valid, rpId: "evil.example" },
        { ...valid, environment: "dev" },
        { ...valid, storageId: "/walletkit/passkey-abcd" },
        { ...valid, storageId: "/walletkit/enrollment-../../x" },
        { ...valid, encryptedSecrets: "" },
        { ...valid, encryptedSecrets: `${valid.encryptedSecrets}=` },
        { ...valid, encryptedSecrets: valid.encryptedSecrets.slice(0, -4) },
        { ...valid, encryptedSecrets: `${valid.encryptedSecrets}AAAA` },
      ];
      for (const value of cases) {
        expect(reason(() => parseSavedWallet(typeof value === "string" ? value : JSON.stringify(value)))).toBe("invalid_record");
      }
      expect(parseSavedWallet(JSON.stringify({ ...valid, seed: "discard" }))).not.toHaveProperty("seed");
    } finally { clearEnrollmentSecrets(secrets); }
  });

  test("sealing refuses invalid metadata", async () => {
    const secrets = await createEnrollmentSecrets();
    const key = await deriveWrappingKey(prf());
    try {
      expect(await failure(sealSavedWallet(secrets, key, { ...metadata, storageId: "/walletkit/other" }))).toBe("invalid_record");
    } finally { clearEnrollmentSecrets(secrets); }
  });
});

describe("wrapping key", () => {
  test("is a non-extractable AES-GCM key and rejects malformed PRF output", async () => {
    const key = await deriveWrappingKey(prf());
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(key.usages.sort()).toEqual(["decrypt", "encrypt"]);
    await expect(deriveWrappingKey(new Uint8Array(31))).rejects.toThrow();
    await expect(deriveWrappingKey(new Uint8Array(33))).rejects.toThrow();
  });

  test("is separate from the keys passkey-derived wallets compute from the same PRF output", async () => {
    const secrets = await createEnrollmentSecrets();
    const { seed, databaseKey } = await deriveWalletKeys(prf());
    try {
      const record = await sealSavedWallet(secrets, await deriveWrappingKey(prf()), metadata);
      for (const bytes of [seed, databaseKey]) {
        const sibling = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
        expect(await failure(openSavedWallet(record, sibling))).toBe("decrypt_failed");
      }
    } finally { clearEnrollmentSecrets(secrets); seed.fill(0); databaseKey.fill(0); }
  });
});

test("contract: binding layout and envelope length are pinned", async () => {
  expect(savedWalletBinding(metadata)).toBe(
    '["world-id/web-authenticator/saved-wallet/v2","a1b2c3d4","auth.worldcoin.dev","staging","/walletkit/enrollment-1b4e28ba-2fa1-4d2b-883f-0016d3cca427"]',
  );
  const { rpId: _, ...hostname } = metadata;
  expect(savedWalletBinding(hostname)).toContain(',"a1b2c3d4",null,"staging",');
  const secrets = await createEnrollmentSecrets();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    expect(await sealEnrollmentSecrets(secrets, key, "binding")).toHaveLength(SEALED_SECRETS_BYTES);
  } finally { clearEnrollmentSecrets(secrets); }
});
