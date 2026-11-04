import { describe, expect, test } from "bun:test";
import { CREATION_RP_IDS, isSharedRpId, rpIdForNewPasskey, SHARED_RP_IDS } from "../lib/passkey-rp";
import { parseWalletProfile } from "../lib/wallet-session";

function runtime(getClientCapabilities?: () => Promise<unknown>) {
  const value = function PublicKeyCredential() {} as unknown as Record<string, unknown>;
  if (getClientCapabilities) value.getClientCapabilities = getClientCapabilities;
  return value;
}

const supported = runtime(async () => ({ relatedOrigins: true }));

describe("shared IdP RP ID for new passkeys", () => {
  test("maps each provisioned web authenticator origin to its IdP hostname", async () => {
    expect(await rpIdForNewPasskey("https://authenticator.toolsforhumanity.dev", supported)).toBe("auth.worldcoin.dev");
    expect(await rpIdForNewPasskey("https://web.sandbox.world.org", supported)).toBe("sandbox.auth.world.org");
    expect(await rpIdForNewPasskey("https://web.world.org", supported)).toBe("auth.world.org");
  });

  test("keeps the page hostname for unknown origins, including local development", async () => {
    for (const origin of ["http://localhost:4173", "https://evil.example", "https://web.world.org.evil.example", "constructor", "__proto__"]) {
      expect(await rpIdForNewPasskey(origin, supported)).toBeUndefined();
    }
  });

  test("keeps the page hostname unless the browser reports Related Origin Requests", async () => {
    const origin = "https://web.world.org";
    expect(await rpIdForNewPasskey(origin, undefined)).toBeUndefined();
    expect(await rpIdForNewPasskey(origin, runtime())).toBeUndefined();
    expect(await rpIdForNewPasskey(origin, runtime(async () => ({})))).toBeUndefined();
    expect(await rpIdForNewPasskey(origin, runtime(async () => ({ relatedOrigins: false })))).toBeUndefined();
    expect(await rpIdForNewPasskey(origin, runtime(async () => ({ relatedOrigins: "true" })))).toBeUndefined();
    expect(await rpIdForNewPasskey(origin, runtime(async () => null))).toBeUndefined();
    expect(await rpIdForNewPasskey(origin, runtime(() => Promise.reject(new Error("unavailable"))))).toBeUndefined();
  });

  test("accepts only the known IdP RP IDs", () => {
    expect(isSharedRpId("auth.world.org")).toBe(true);
    expect(isSharedRpId("web.world.org")).toBe(false);
    expect(isSharedRpId("world.org")).toBe(false);
    expect(isSharedRpId(undefined)).toBe(false);
  });

  test("every RP ID used for creation stays unlockable", () => {
    for (const rpId of CREATION_RP_IDS) expect(SHARED_RP_IDS.has(rpId)).toBe(true);
  });

  test("unlock accepts RP IDs independently of the creation mapping, so the kill switch keeps saved wallets", () => {
    // Removing an origin from the creation map must not remove its RP ID from this set.
    expect([...SHARED_RP_IDS].sort()).toEqual(["auth.world.org", "auth.worldcoin.dev", "sandbox.auth.world.org"]);
  });
});

describe("saved wallet RP ID", () => {
  test("profiles saved before the shared RP ID keep using the page hostname", () => {
    expect(parseWalletProfile('{"version":1,"credentialId":"abcd"}')).toEqual({ version: 1, credentialId: "abcd" });
  });

  test("profiles created under the shared RP ID keep it", () => {
    expect(parseWalletProfile('{"version":1,"credentialId":"abcd","rpId":"auth.world.org"}'))
      .toEqual({ version: 1, credentialId: "abcd", rpId: "auth.world.org" });
  });

  test("rejects an unknown RP ID instead of unlocking under a different relying party", () => {
    for (const rpId of ['"example.com"', '"world.org"', "null", "1"]) {
      expect(() => parseWalletProfile(`{"version":1,"credentialId":"abcd","rpId":${rpId}}`)).toThrow();
    }
  });
});
