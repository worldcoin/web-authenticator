import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { activateStagingWallet } from "../src/wallet/registration";
import { registrationState, saveRegistrationState } from "../src/wallet/persistence";
import type { WalletKit } from "../src/lib/walletkit";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => window.localStorage.clear());
function fixture() {
  const calls: string[] = [];
  let fail = false;
  const wallet = {
    register: async () => { expect(registrationState("ab")).toBe("submitting"); calls.push("register"); if (fail) throw new Error("network"); },
    pollRegistration: async () => ({ state: "finalized" }),
    initializeAuthenticator: async () => { calls.push("init"); },
    terminate: () => calls.push("terminate"),
  } as unknown as WalletKit;
  return { wallet, calls, fail: () => { fail = true; } };
}
const activate = (wallet: WalletKit) => activateStagingWallet(wallet, new Uint8Array(32), "ab", new AbortController().signal, () => {});
test("registers once and initializes the encrypted wallet", async () => {
  const f = fixture(); await activate(f.wallet);
  expect(f.calls).toEqual(["register", "init"]);
  expect(registrationState("ab")).toBe("finalized");
});
test("ambiguous registration is persisted; retry checks the account without submitting again", async () => {
  const f = fixture(); f.fail(); await expect(activate(f.wallet)).rejects.toThrow("may already have been submitted");
  expect(registrationState("ab")).toBe("submitting");
  const retry = fixture(); await activate(retry.wallet);
  expect(retry.calls).toEqual(["init"]);
});
test("finalized registration never submits again", async () => {
  saveRegistrationState("ab", "finalized"); const f = fixture(); await activate(f.wallet);
  expect(f.calls).toEqual(["init"]);
});
test("malformed registration metadata fails closed", async () => {
  window.localStorage.setItem("world-id-staging-registration-v1:ab", "unknown");
  const f = fixture(); await expect(activate(f.wallet)).rejects.toThrow("Saved registration");
  expect(f.calls).toEqual([]);
});
