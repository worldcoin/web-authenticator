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
    query: async () => ({ held: [...held].map(name => ({ name })) }),
  } });
  await expect(claimWallet()).rejects.toThrow("Lock requests are not allowed here");
  expect([...held]).toEqual([]);
});

test("a released tenure cannot become busy, so it never blocks other tabs", async () => {
  const held = new Map<string, number>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (name: string, _options: unknown, callback: (lock: object | null) => unknown) => {
      held.set(name, (held.get(name) ?? 0) + 1);
      try { return await callback({}); } finally { held.set(name, held.get(name)! - 1); }
    },
    query: async () => ({ held: [] }),
  } });
  const tenure = await claimWallet();
  tenure.release();
  await expect(tenure.holdBusy()).rejects.toThrow("continued in another tab");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(Object.fromEntries(held)).toEqual({ "world-id-wallet-busy-v1": 0, "world-id-wallet-open-v1": 0 });
});
