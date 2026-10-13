import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { prfBytes } from "../src/wallet/prf-result";
import { deriveWalletKeys } from "../src/wallet/session";
import { WalletOpenError, walletOpenErrorMessage } from "../src/wallet/errors";

test("provider arrays, typed arrays and native buffers derive the same PR9 wallet keys", async () => {
  const bytes = Array.from({ length: 32 }, (_, index) => index);
  const expected = await deriveWalletKeys(Uint8Array.from(bytes));
  for (const output of [bytes, Uint8Array.from(bytes), Uint8Array.from(bytes).buffer]) {
    expect(await deriveWalletKeys(prfBytes(output)!)).toEqual(expected);
  }
});

test("normalizes cross-realm buffers and sliced views without reading outside the view", () => {
  const backing = new Uint8Array(40).fill(9);
  expect(prfBytes(backing.subarray(4, 36))).toEqual(new Uint8Array(32).fill(9));
  expect(backing[0]).toBe(9);
  expect(backing.subarray(4, 36).every(byte => byte === 0)).toBe(true);
  expect(prfBytes(runInNewContext("new Uint8Array(32).fill(7).buffer"))).toEqual(new Uint8Array(32).fill(7));
});

test("malformed PRF results fail closed without coercing missing or invalid bytes", () => {
  for (const output of [undefined, null, "bytes", new Array(32), Array(31).fill(1), Array(33).fill(1),
    Array(32).fill(-1), Array(32).fill(256), Array(32).fill(1.5), Array(32).fill("7"), Array(32).fill(NaN), new Uint8Array(31)]) {
    expect(prfBytes(output)).toBeUndefined();
  }
});

test("only deliberate PRF failures blame PRF; cancellation and storage failures stay distinct", () => {
  expect(walletOpenErrorMessage(new WalletOpenError("This passkey provider does not support PRF."))).toContain("does not support PRF");
  expect(walletOpenErrorMessage(new WalletOpenError("Wallet setup is already running in another tab."))).toContain("another tab");
  expect(walletOpenErrorMessage(new DOMException("sensitive detail", "NotAllowedError"))).toContain("cancelled");
  expect(walletOpenErrorMessage(new DOMException("sensitive detail", "QuotaExceededError"))).toContain("insufficient storage");
  const unknown = walletOpenErrorMessage(new Error("private worker payload"));
  expect(unknown).toContain("could not initialize");
  expect(unknown).not.toContain("private worker payload");
});
