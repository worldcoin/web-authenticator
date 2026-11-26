import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { WalletKitWasm } from "../../config/build-manifest";
import { WalletOpenError } from "../lib/wallet-errors";
import { loadWalletKitWasm } from "../lib/walletkit-wasm";

const wasm = new Uint8Array(300_000).map((_, index) => index % 251);
const sha256 = createHash("sha256").update(wasm).digest("hex");
let server: ReturnType<typeof Bun.serve>;
let origin: string;

// A static host like the deployed one: the gzip file is served as-is, and unknown paths get index.html.
beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: request => {
    const { pathname } = new URL(request.url);
    if (pathname === "/assets/walletkit.wasm.gzip.bin") return new Response(gzipSync(wasm), { headers: { "Content-Type": "application/octet-stream" } });
    if (pathname === "/assets/truncated.wasm.gzip.bin") return new Response(gzipSync(wasm).subarray(0, 1_000), { headers: { "Content-Type": "application/octet-stream" } });
    return new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
  } });
  origin = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

const expected = (overrides: Partial<WalletKitWasm> = {}): WalletKitWasm =>
  ({ url: `${origin}/assets/walletkit.wasm.gzip.bin`, byteLength: wasm.byteLength, sha256, ...overrides });
const signal = () => new AbortController().signal;

test("the gzipped WASM becomes a blob URL holding the exact original bytes", async () => {
  const url = await loadWalletKitWasm(signal(), expected());
  try {
    expect(url.startsWith("blob:")).toBe(true);
    const blob = await (await fetch(url)).blob();
    expect(blob.type).toBe("application/wasm");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(wasm);
  } finally {
    URL.revokeObjectURL(url);
  }
});

test("bytes that differ from the build's digest or size are refused", async () => {
  for (const mismatch of [{ sha256: "0".repeat(64) }, { byteLength: wasm.byteLength + 1 }]) {
    const failure = await loadWalletKitWasm(signal(), expected(mismatch)).catch(error => error);
    expect(failure).toBeInstanceOf(WalletOpenError);
    expect(failure.message).toContain("integrity check");
  }
});

test("a missing or truncated file is a load failure, and an abort stays an abort", async () => {
  for (const path of ["/assets/missing.wasm.gzip.bin", "/assets/truncated.wasm.gzip.bin"]) {
    const failure = await loadWalletKitWasm(signal(), expected({ url: origin + path })).catch(error => error);
    expect(failure).toBeInstanceOf(WalletOpenError);
    expect(failure.message).toContain("could not load its wallet engine");
  }
  const aborted = new AbortController();
  aborted.abort(new DOMException("left the page", "AbortError"));
  await expect(loadWalletKitWasm(aborted.signal, expected())).rejects.toThrow("left the page");
});
