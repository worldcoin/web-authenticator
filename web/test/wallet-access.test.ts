import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { openAuthenticator, openPasskeyWallet, PRF_INPUT_LABEL } from "../lib/wallet-session";

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://localhost/" });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(globalThis, "PublicKeyCredential", { configurable: true, value: class {} });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) } });
});
afterAll(() => GlobalRegistrator.unregister());

test("explicit access mode cannot create or replace a saved authenticator", async () => {
  const signal = new AbortController().signal;
  let requested: CredentialRequestOptions | undefined;
  Object.defineProperty(navigator, "credentials", { configurable: true, value: {
    get: async (options: CredentialRequestOptions) => { requested = options; throw new DOMException("Cancelled", "NotAllowedError"); },
    create: async () => { throw new Error("Sign-in must not create a passkey"); },
  } });
  await expect(openAuthenticator(signal, () => {}, "open")).rejects.toThrow("Cancelled");
  expect(requested?.publicKey?.allowCredentials).toBeUndefined();
  localStorage.setItem("world-id-wallet-v1", '{"version":1,"credentialId":"ab"}');
  await expect(openAuthenticator(signal, () => {}, "create")).rejects.toThrow("already exists");
  expect(localStorage.getItem("world-id-wallet-v1")).toBe('{"version":1,"credentialId":"ab"}');
  localStorage.clear();
});

for (const results of [{}, { first: new Uint8Array(31) }]) {
  test(`malformed creation-time PRF results fail without a second prompt (${Object.keys(results).join() || "missing first"})`, async () => {
    let assertions = 0;
    let input: CredentialCreationOptions | undefined;
    const credential = Object.assign(Object.create(PublicKeyCredential.prototype), {
      type: "public-key", rawId: Uint8Array.of(0xab).buffer,
      getClientExtensionResults: () => ({ prf: { enabled: true, results } }),
    });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: {
      create: async (options: CredentialCreationOptions) => { input = options; return credential; },
      get: async () => { assertions++; throw new Error("Unexpected second prompt"); },
    } });
    try {
      await expect(openPasskeyWallet(new AbortController().signal)).rejects.toThrow("did not provide the PRF output");
      expect(input?.publicKey?.extensions).toEqual({ prf: { eval: { first: new TextEncoder().encode(PRF_INPUT_LABEL) } } });
      expect(assertions).toBe(0);
      expect(JSON.parse(localStorage.getItem("world-id-wallet-v1")!)).toEqual({ version: 1, credentialId: "ab" });
    } finally { localStorage.clear(); }
  });
}

test("cancellation after creation erases the PRF output without opening a worker or prompting again", async () => {
  const controller = new AbortController();
  const output = new Uint8Array(32).fill(7);
  let assertions = 0;
  const credential = Object.assign(Object.create(PublicKeyCredential.prototype), {
    type: "public-key", rawId: Uint8Array.of(0xab).buffer,
    getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: output } } }),
  });
  Object.defineProperty(navigator, "credentials", { configurable: true, value: {
    create: async () => { controller.abort(new DOMException("Cancelled", "AbortError")); return credential; },
    get: async () => { assertions++; throw new Error("Unexpected second prompt"); },
  } });
  try {
    await expect(openPasskeyWallet(controller.signal)).rejects.toThrow("Cancelled");
    expect(assertions).toBe(0);
    expect(output.every(byte => byte === 0)).toBe(true);
  } finally { localStorage.clear(); }
});
