import { describe, expect, test } from "bun:test";
import { deriveWalletKeys, parseWalletProfile, PRF_INPUT_LABEL } from "../lib/wallet-session";
import { PRF_INPUT_V1_LABEL, PRF_INPUT_V1_SHA256 } from "../../packages/contracts/src";

describe("passkey wallet key boundary", () => {
  test("rejects malformed metadata instead of silently creating a replacement wallet", () => {
    for (const value of ["null", "{}", '{"version":2,"credentialId":"ab"}', '{"version":1,"credentialId":"a"}', '{"version":1,"credentialId":"zz"}']) {
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

test("the passkey PRF input is the exported v1 contract input", async () => {
  expect(PRF_INPUT_LABEL).toBe(PRF_INPUT_V1_LABEL);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PRF_INPUT_LABEL)));
  expect(Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")).toBe(PRF_INPUT_V1_SHA256);
});
