import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { ENVIRONMENTS, WORLD_CHAIN_RPC_URL, type ProtocolEnvironment } from "../../config/environment";
import { pause } from "./async";

const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 5_000;
const RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
/** JSON-RPC: resource unavailable, limit exceeded, internal error. */
const RETRYABLE_RPC_CODES = new Set([-32002, -32005, -32603]);

const abi = parseAbi([
  "function getRp(uint64 rpId) view returns ((bool initialized, bool active, address manager, address signer, uint160 oprfKeyId, string unverifiedWellKnownDomain))",
]);

export type RegisteredRp = { signer: Hex; oprfKeyId: bigint };

/** Reads an RP from the environment's on-chain RpRegistry; rejects when it is unregistered or inactive. */
export async function readRegisteredRp(rpId: string, environment: ProtocolEnvironment, signal: AbortSignal): Promise<RegisteredRp> {
  if (!/^rp_[0-9a-f]{1,16}$/i.test(rpId)) throw new Error("Invalid RP ID.");
  const data = encodeFunctionData({ abi, functionName: "getRp", args: [BigInt(`0x${rpId.slice(3)}`)] });
  const result = await ethCallWithRetries(ENVIRONMENTS[environment].rpRegistry, data, signal);
  const rp = decodeFunctionResult({ abi, functionName: "getRp", data: result });
  if (!rp.initialized || !rp.active) throw new Error(`This RP is not active on ${environment}.`);
  return { signer: rp.signer, oprfKeyId: rp.oprfKeyId };
}

async function ethCallWithRetries(to: Hex, data: Hex, signal: AbortSignal): Promise<Hex> {
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await ethCall(to, data, AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]));
    } catch (error) {
      signal.throwIfAborted();
      const failure = error instanceof RpcFailure ? error : new RpcFailure("World Chain RPC is unreachable.", true, undefined, { cause: error });
      if (attempt === ATTEMPTS || !failure.retryable) throw failure;
      const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      const jittered = backoff / 2 + Math.random() * backoff / 2;
      await pause(Math.min(MAX_RETRY_DELAY_MS, Math.max(jittered, failure.retryAfterMs ?? 0)), signal);
    }
  }
}

/** One `eth_call`; the signal covers the response body as well as the request. */
async function ethCall(to: Hex, data: Hex, signal: AbortSignal): Promise<Hex> {
  const response = await fetch(WORLD_CHAIN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal,
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new RpcFailure(`World Chain RPC answered ${response.status}.`, RETRYABLE_HTTP_STATUSES.has(response.status), retryAfterMs(response));
  }
  const reply = await response.json() as { result?: unknown; error?: { code?: unknown } };
  if (reply.error) {
    const code = typeof reply.error.code === "number" ? reply.error.code : undefined;
    throw new RpcFailure(`World Chain RPC returned error ${code ?? "unknown"}.`, code !== undefined && RETRYABLE_RPC_CODES.has(code));
  }
  if (typeof reply.result !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(reply.result)) {
    throw new RpcFailure("World Chain RPC returned a malformed result.", false);
  }
  return reply.result as Hex;
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

class RpcFailure extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfterMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "RpcFailure";
  }
}
