import { initializeWalletKit, type WalletKit } from "@worldcoin/walletkit-web";
import { WalletOpenError } from "./wallet-errors";

const LOAD_FAILED = "The authenticator could not load its wallet engine. Check your connection and try again.";

/**
 * Starts the WalletKit worker. The WASM is deployed gzipped because it exceeds the static
 * host's file size limit, so the page decompresses it and hands the worker a blob URL.
 */
export async function initializeWalletKitFromCompressedWasm(signal: AbortSignal): Promise<WalletKit> {
  const wasmUrl = await loadWalletKitWasm(signal);
  try {
    return await initializeWalletKit({ signal, wasmUrl });
  } finally {
    URL.revokeObjectURL(wasmUrl);
  }
}

/** Resolves to a blob URL of the decompressed WASM, checked against the build's size and digest. */
export async function loadWalletKitWasm(signal: AbortSignal, expected = __WALLETKIT_WASM__): Promise<string> {
  let wasm: ArrayBuffer;
  try {
    const response = await fetch(expected.url, { signal });
    if (!response.ok || !response.body) throw new Error(`WalletKit WASM request failed (${response.status}).`);
    wasm = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  } catch (cause) {
    signal.throwIfAborted();
    throw new WalletOpenError(LOAD_FAILED, { cause });
  }
  if (wasm.byteLength !== expected.byteLength || await sha256Hex(wasm) !== expected.sha256) {
    throw new WalletOpenError("The authenticator's wallet engine failed its integrity check. Reload the page and try again.");
  }
  return URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
