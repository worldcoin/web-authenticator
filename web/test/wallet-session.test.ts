import { describe, expect, test } from "bun:test";
import { deriveWalletKeys, parseWalletProfile, PRF_INPUT_LABEL } from "../lib/wallet-session";
import { PRF_INPUT_V1_LABEL, PRF_INPUT_V1_SHA256 } from "../../packages/contracts/src";
import { deriveFaceIdentitySeed, FACE_IDENTITY_INFO } from '../lib/face-identity-seed';

describe("passkey wallet key boundary", () => {
  test("rejects malformed metadata instead of silently creating a replacement wallet", () => {
    for (const value of ["{", "null", "{}", '{"version":2,"credentialId":"ab"}', '{"version":1,"credentialId":"a"}', '{"version":1,"credentialId":"zz"}']) {
      expect(() => parseWalletProfile(value)).toThrow();
    }
    expect(parseWalletProfile('{"version":1,"credentialId":"abcd","seed":"discard"}'))
      .toEqual({ version: 1, credentialId: "abcd" });
  });

  test("reopening derives stable, distinct keys; another passkey produces different keys", async () => {
    const prf = new Uint8Array(32).fill(7);
    const first = await deriveWalletKeys(prf);
    const reopened = await deriveWalletKeys(prf);
    const other = await deriveWalletKeys(new Uint8Array(32).fill(8));
    expect(first).toEqual(reopened);
    expect(first.seed).toHaveLength(32);
    expect(first.databaseKey).toHaveLength(32);
    expect(first.seed).not.toEqual(first.databaseKey);
    expect(first.databaseKey).not.toEqual(other.databaseKey);
    await expect(deriveWalletKeys(new Uint8Array(31))).rejects.toThrow();
  });
});

test('face identity v1 is deterministic and domain separated without changing wallet keys', async () => {
  const prf = new Uint8Array(32).fill(7);
  const face = await deriveFaceIdentitySeed(prf);
  const keys = await deriveWalletKeys(prf);
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
  expect(FACE_IDENTITY_INFO).toBe('face-identity/v1');
  expect(hex(face)).toBe('a5c838ba848d2ef877c8fe1eca94100151ef64c9c5268588732628c434e6456b');
  expect(hex(keys.seed)).toBe('8e329b68b9cba7db3abfd49569f9736f3f2edef507abaed41393d7af4ee5283a');
  expect(hex(keys.databaseKey)).toBe('39d7f9441238e4a2bab1b6bc7ed91ddb6091facf2d0f8ba84c588781ff874161');
  expect(await deriveFaceIdentitySeed(prf)).toEqual(face);
  expect(await deriveFaceIdentitySeed(new Uint8Array(32).fill(8))).not.toEqual(face);
  expect(prf).toEqual(new Uint8Array(32).fill(7));
  await expect(deriveFaceIdentitySeed(new Uint8Array(31))).rejects.toThrow('invalid PRF');
});

test("the passkey PRF input is the exported v1 contract input", async () => {
  expect(PRF_INPUT_LABEL).toBe(PRF_INPUT_V1_LABEL);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PRF_INPUT_LABEL)));
  expect(Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")).toBe(PRF_INPUT_V1_SHA256);
});
