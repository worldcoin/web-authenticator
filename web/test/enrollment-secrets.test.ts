import { expect, test } from "bun:test";
import { clearEnrollmentSecrets, createEnrollmentSecrets, openEnrollmentSecrets, sealEnrollmentSecrets } from "../lib/enrollment-secrets";

test("passkey-free secrets are independent and wrapping preserves the original wallet and custody keys", async () => {
  const first = await createEnrollmentSecrets();
  const other = await createEnrollmentSecrets();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  try {
    expect(first.seed).not.toEqual(other.seed);
    expect(first.seed).not.toEqual(first.databaseKey);
    expect(first.custodyPublicKey).not.toEqual(other.custodyPublicKey);
    const wrapped = await sealEnrollmentSecrets(first, key, "wallet-a");
    const restored = await openEnrollmentSecrets(wrapped, key, "wallet-a");
    expect(restored).toEqual(first);
    clearEnrollmentSecrets(restored);
    await expect(openEnrollmentSecrets(wrapped, key, "wallet-b")).rejects.toThrow();
    wrapped[wrapped.length - 1] ^= 1;
    await expect(openEnrollmentSecrets(wrapped, key, "wallet-a")).rejects.toThrow();
  } finally { clearEnrollmentSecrets(first); clearEnrollmentSecrets(other); }
  for (const bytes of Object.values(first)) expect(bytes.every((byte: number) => byte === 0)).toBe(true);
});

test("saved-key envelopes reject unsupported versions and invalid lengths", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  for (const value of [new Uint8Array(), new Uint8Array(157), new Uint8Array(158).fill(1)]) {
    await expect(openEnrollmentSecrets(value, key, "wallet")).rejects.toThrow();
  }
});
