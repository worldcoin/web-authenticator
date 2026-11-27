import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { claimWallet } from "../lib/tab-handoff";

beforeAll(() => GlobalRegistrator.register({ url: "https://localhost/" }));
afterAll(() => GlobalRegistrator.unregister());

test("a wallet lock request that fails before its grant rejects the claim and frees the busy gate", async () => {
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (name: string, _options: unknown, callback: (lock: object | null) => unknown) => {
      if (name === "world-id-wallet-open-v1") throw new DOMException("Lock requests are not allowed here", "SecurityError");
      held.add(name);
      try { return await callback({}); } finally { held.delete(name); }
    },
  } });
  await expect(claimWallet()).rejects.toThrow("Lock requests are not allowed here");
  expect([...held]).toEqual([]);
});
