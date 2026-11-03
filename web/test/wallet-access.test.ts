import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { openAuthenticator } from "../lib/wallet-session";

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://localhost/" });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(globalThis, "PublicKeyCredential", { configurable: true, value: class {} });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) } });
});
afterAll(() => GlobalRegistrator.unregister());

test("explicit access mode cannot create or replace a saved authenticator", async () => {
  const signal = new AbortController().signal;
  await expect(openAuthenticator(signal, () => {}, "open")).rejects.toThrow("No saved authenticator");
  localStorage.setItem("world-id-wallet-v1", '{"version":1,"credentialId":"ab"}');
  await expect(openAuthenticator(signal, () => {}, "create")).rejects.toThrow("already exists");
  expect(localStorage.getItem("world-id-wallet-v1")).toBe('{"version":1,"credentialId":"ab"}');
  localStorage.clear();
});
