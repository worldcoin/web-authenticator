import { expect, test } from "bun:test";
import type { initializeWalletKit, WalletKit as WorkerWallet } from "@worldcoin/walletkit-web";
import { prepareEnrollmentSession } from "../lib/enrollment-session";

function fixture(status = "finalized") {
  const calls = { initialized: 0, registered: 0, stopped: 0, freed: 0, seed: new Uint8Array(), key: new Uint8Array() };
  const free = () => { calls.freed++; };
  const field = (hex: string) => ({ toHexString: async () => hex, free });
  const worker = {
    terminate: () => { calls.stopped++; },
    StoragePaths: { fromRoot: async () => ({ free }) },
    StorageKeys: { fromBytes: async (key: Uint8Array) => { calls.key = key.slice(); return { free }; } },
    CredentialStore: { new: async () => ({}) },
    InitializingAuthenticator: { registerWithDefaults: async (seed: Uint8Array) => {
      calls.registered++; calls.seed = seed.slice(); return { pollStatus: async () => ({ state: status }) };
    } },
    EmbeddedZkArtifacts: { new: async () => ({ free }) },
    Authenticator: { initWithDefaults: async () => ({
      initStorage: async () => {},
      generateCredentialBlindingFactorRemote: async () => field("0x02"),
      computeCredentialSub: async () => field("0x01"),
    }) },
  } as unknown as WorkerWallet;
  const initialize: typeof initializeWalletKit = async () => { calls.initialized++; return worker; };
  return { calls, initialize };
}

test("setup registers once, prepares a subject/custody key, and keeps one owner until disposal", async () => {
  const f = fixture();
  const controller = new AbortController();
  const session = await prepareEnrollmentSession(controller.signal, undefined, f.initialize);
  expect(f.calls.registered).toBe(1);
  expect(f.calls.seed).not.toEqual(f.calls.key);
  expect(session.sub).toBe("0x1");
  expect(session.blindingFactor).toBe("0x02");
  expect(session.custodyPublicKey).toHaveLength(32);
  expect(session.storageId).toStartWith("/walletkit/enrollment-");
  expect(f.calls.stopped).toBe(0);
  controller.abort();
  session.dispose();
  expect(f.calls.stopped).toBe(1);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  await expect(session.sealSecrets(key, "wallet")).rejects.toThrow("closed");
});

test("pre-aborted setup never starts the worker", async () => {
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  await expect(prepareEnrollmentSession(controller.signal, undefined, f.initialize)).rejects.toThrow();
  expect(f.calls.initialized).toBe(0);
});

test("a failed registration closes the worker without automatically registering again", async () => {
  const f = fixture("failed");
  await expect(prepareEnrollmentSession(new AbortController().signal, undefined, f.initialize)).rejects.toThrow("registration");
  expect(f.calls.registered).toBe(1);
  expect(f.calls.stopped).toBe(1);
});
