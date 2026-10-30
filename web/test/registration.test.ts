import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { activateWallet } from "../lib/wallet-registration";
import { registrationState, saveRegistrationState } from "../lib/wallet-persistence";
import type { WalletKit } from "../lib/walletkit";
import { WalletRegistrationError } from "../lib/wallet-errors";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
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
const activate = (wallet: WalletKit) => activateWallet(wallet, new Uint8Array(32), "ab", new AbortController().signal, () => {});
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

test("a definitive registration failure allows an explicit retry with the same passkey", async () => {
  const f = fixture();
  f.wallet.pollRegistration = async () => ({ state: "failed", error: "gateway rejected" });
  await expect(activate(f.wallet)).rejects.toThrow("Registration failed");
  expect(registrationState("ab")).toBe("failed");
  expect(f.calls).toEqual(["register", "terminate"]);
  const retry = fixture();
  await activate(retry.wallet);
  expect(retry.calls).toEqual(["register", "init"]);
  expect(registrationState("ab")).toBe("finalized");
});

for (const step of ["register", "pollRegistration"] as const) {
  test(`${step} timeout stops the worker and retry checks without resubmitting`, async () => {
    const f = fixture();
    f.wallet[step] = () => new Promise<never>(() => {});
    const deadline = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    try {
      const result = activate(f.wallet);
      // Allow submission to finish and polling to start in the polling case.
      await new Promise(resolve => setTimeout(resolve, 0));
      deadline.abort(new DOMException("Timed out", "TimeoutError"));
      await expect(result).rejects.toBeInstanceOf(WalletRegistrationError);
      await expect(result).rejects.toMatchObject({ timedOut: true });
      expect(timeout).toHaveBeenCalledWith(30_000);
      expect(registrationState("ab")).toBe("submitting");
      expect(f.calls).toContain("terminate");
    } finally { timeout.mockRestore(); }
    const retry = fixture();
    await activate(retry.wallet);
    expect(retry.calls).toEqual(["init"]);
    expect(registrationState("ab")).toBe("finalized");
  });
}

test("an unsuccessful account check after timeout preserves the uncertain registration", async () => {
  saveRegistrationState("ab", "submitting");
  const f = fixture();
  f.wallet.initializeAuthenticator = async () => { throw new Error("Account unavailable"); };
  await expect(activate(f.wallet)).rejects.toThrow("Retry with your existing passkey");
  expect(registrationState("ab")).toBe("submitting");
  expect(f.calls).toEqual(["terminate"]);
});
