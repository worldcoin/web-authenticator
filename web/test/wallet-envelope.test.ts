import { expect, test } from "bun:test";
import { parseWalletProfile } from "../lib/wallet-session";
import { parseWrappedProfile, unwrapTemporaryWallet, wrapTemporaryWallet, type TemporaryWalletMaterial } from "../lib/wallet-envelope";

const material = (): TemporaryWalletMaterial => ({ seed: new Uint8Array(32).fill(7), databaseKey: new Uint8Array(32).fill(9),
  storageRoot: "/walletkit/temporary-550e8400-e29b-41d4-a716-446655440000", persisted: false });

test("saving wraps the existing random identity and vault key; reopening restores both", async () => {
  const source = material();
  const prf = new Uint8Array(32).fill(3);
  const profile = await wrapTemporaryWallet(source, "abcd", prf);
  expect(parseWalletProfile(JSON.stringify(profile))).toEqual(profile);
  expect(await unwrapTemporaryWallet(profile, prf)).toEqual({ seed: source.seed, databaseKey: source.databaseKey });
  expect(profile.ciphertext).not.toContain("07".repeat(32));
  expect(profile.ciphertext).not.toContain("09".repeat(32));
  expect(source.seed).toEqual(new Uint8Array(32).fill(7));
  expect(parseWalletProfile('{"version":1,"credentialId":"abcd"}')).toEqual({ version: 1, credentialId: "abcd" });
});

test("envelope rejects another passkey, modified ciphertext, or changed identity/path binding", async () => {
  const prf = new Uint8Array(32).fill(3);
  const profile = await wrapTemporaryWallet(material(), "abcd", prf);
  await expect(unwrapTemporaryWallet(profile, new Uint8Array(32).fill(4))).rejects.toBeDefined();
  for (const changed of [
    { ...profile, credentialId: "abce" },
    { ...profile, storageRoot: profile.storageRoot.replace("440000", "440001") },
    { ...profile, ciphertext: (profile.ciphertext[0] === "0" ? "1" : "0") + profile.ciphertext.slice(1) },
  ]) await expect(unwrapTemporaryWallet(changed, prf)).rejects.toBeDefined();
});

test("saved envelopes validate keys, paths and lengths before opening a vault", async () => {
  const profile = await wrapTemporaryWallet(material(), "abcd", new Uint8Array(32));
  for (const changed of [{ ...profile, iv: "00" }, { ...profile, ciphertext: "00" }, { ...profile, storageRoot: "/another-wallet" }]) {
    expect(() => parseWrappedProfile(changed)).toThrow("invalid");
  }
});
