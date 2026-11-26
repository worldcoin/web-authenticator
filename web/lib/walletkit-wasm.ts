import { initializeWalletKit, type WalletKit } from "@worldcoin/walletkit-web";
import { logFlowStep } from "./flow-logging";
import { WalletOpenError } from "./wallet-errors";

const LOAD_FAILED = "The authenticator could not load its wallet engine. Check your connection and try again.";

/**
 * Starts the WalletKit worker. The WASM is deployed gzipped because it exceeds the static
 * host's file size limit, so the page decompresses it and hands the worker a blob URL.
 */
export async function initializeWalletKitFromCompressedWasm(signal: AbortSignal): Promise<WalletKit> {
  const wasmUrl = await logFlowStep("walletkit.wasm_load", () => loadWalletKitWasm(signal));
  try {
    return await logFlowStep("walletkit.worker_initialize", () => initializeWalletKit({ signal, wasmUrl }));
  } finally {
    URL.revokeObjectURL(wasmUrl);
  }
}

/** Resolves to a blob URL of the decompressed WASM, checked against the build's size and digest. */
export async function loadWalletKitWasm(signal: AbortSignal, expected = __WALLETKIT_WASM__): Promise<string> {
  let wasm: Blob;
  let digest: string;
  try {
    const response = await fetch(expected.url, { signal });
    if (!response.ok || !response.body) throw new Error(`WalletKit WASM request failed (${response.status}).`);
    const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
    wasm = await new Response(decompressed).blob();
    signal.throwIfAborted();
    digest = await sha256Hex(await wasm.arrayBuffer());
  } catch (cause) {
    signal.throwIfAborted();
    throw new WalletOpenError(LOAD_FAILED, { cause });
  }
  if (wasm.size !== expected.byteLength || digest !== expected.sha256) {
    throw new WalletOpenError("The authenticator's wallet engine failed its integrity check. Reload the page and try again.");
  }
  signal.throwIfAborted();
  // The worker compiles while streaming only from a response typed as WASM.
  return URL.createObjectURL(wasm.slice(0, wasm.size, "application/wasm"));
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
