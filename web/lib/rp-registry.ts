import { BaseError, createPublicClient, http, HttpRequestError, parseAbi, TimeoutError, type Hex } from "viem";
import { ENVIRONMENTS, WORLD_CHAIN_RPC_URL, type ProtocolEnvironment } from "../../config/environment";
import { abortable, pause } from "./async";

const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 5_000;
const RETRY_BASE_DELAY_MS = 250;

const abi = parseAbi([
  "function getRp(uint64 rpId) view returns ((bool initialized, bool active, address manager, address signer, uint160 oprfKeyId, string unverifiedWellKnownDomain))",
]);
// Retries are owned by readRegisteredRp, which adds jitter and honours the caller's signal.
const client = createPublicClient({ transport: http(WORLD_CHAIN_RPC_URL, { timeout: ATTEMPT_TIMEOUT_MS, retryCount: 0 }) });

export type RegisteredRp = { signer: Hex; oprfKeyId: bigint };

/** Reads an RP from the environment's on-chain RpRegistry; rejects when it is unregistered or inactive. */
export async function readRegisteredRp(rpId: string, environment: ProtocolEnvironment, signal: AbortSignal): Promise<RegisteredRp> {
  if (!/^rp_[0-9a-f]{1,16}$/i.test(rpId)) throw new Error("Invalid RP ID.");
  const rp = await withRetries(() => client.readContract({
    address: ENVIRONMENTS[environment].rpRegistry, abi, functionName: "getRp", args: [BigInt(`0x${rpId.slice(3)}`)],
  }), signal);
  if (!rp.initialized || !rp.active) throw new Error(`This RP is not active on ${environment}.`);
  return { signer: rp.signer, oprfKeyId: rp.oprfKeyId };
}

async function withRetries<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await abortable(read(), signal);
    } catch (error) {
      signal.throwIfAborted();
      if (attempt === ATTEMPTS || !isTransportFailure(error)) throw error;
      const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await pause(backoff / 2 + Math.random() * backoff / 2, signal);
    }
  }
}

function isTransportFailure(error: unknown): boolean {
  return error instanceof BaseError &&
    error.walk(cause => cause instanceof HttpRequestError || cause instanceof TimeoutError) !== null;
}
