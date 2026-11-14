import { abortable } from "./async";
import { parseEnrollmentChallenge, type EnrollmentChallenge } from "./enrollment-contract";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4096;

export interface EnrollmentChallengeOptions {
  /** Trusted configuration for a browser-accessible PVS challenge route. */
  endpoint: string;
  signal: AbortSignal;
}

export class EnrollmentChallengeError extends Error {
  constructor(
    message: string,
    readonly code: "http_error" | "invalid_response" | "request_timeout" | "request_failed",
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EnrollmentChallengeError";
  }
}

function endpoint(value: string): URL {
  const url = new URL(value);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.pathname !== "/api/v4/zkp/challenge/enrollment" ||
    url.search || url.hash || url.username || url.password) {
    throw new TypeError("Challenge endpoint must be an HTTPS /api/v4/zkp/challenge/enrollment URL without query, fragment, or credentials.");
  }
  return url;
}

async function readChallenge(response: Response, signal: AbortSignal): Promise<EnrollmentChallenge> {
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Missing challenge response body");
  let complete = false;
  try {
    if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new TypeError("Challenge response must be JSON");
    }
    const bytes = new Uint8Array(MAX_RESPONSE_BYTES);
    let size = 0;
    for (;;) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      if (size + value.byteLength > bytes.byteLength) throw new TypeError("Challenge response is too large");
      bytes.set(value, size);
      size += value.byteLength;
    }
    complete = true;
    return parseEnrollmentChallenge(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown);
  } finally {
    // Cleanup must not replace the validation or cancellation error.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fetches once. The caller supplies the returned challenge to finishEnrollment. */
export async function fetchEnrollmentChallenge(options: EnrollmentChallengeOptions): Promise<EnrollmentChallenge> {
  options.signal.throwIfAborted();
  const url = endpoint(options.endpoint);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = AbortSignal.any([options.signal, timeout]);
  try {
    signal.throwIfAborted();
    const response = await abortable(fetch(url, {
      method: "POST", signal, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
    }), signal);
    if (response.status !== 201) {
      // Error bodies are not part of the challenge contract and may be non-JSON edge responses.
      void response.body?.cancel().catch(() => {});
      throw new EnrollmentChallengeError(`Ownership challenge request failed (HTTP ${response.status}).`, "http_error", response.status);
    }
    try {
      return await readChallenge(response, signal);
    } catch (cause) {
      throw new EnrollmentChallengeError("PVS returned an invalid or expired enrollment ownership challenge. Obtain a fresh challenge.", "invalid_response", response.status, { cause });
    }
  } catch (cause) {
    if (options.signal.aborted) throw options.signal.reason;
    if (timeout.aborted) throw new EnrollmentChallengeError("Ownership challenge request timed out.", "request_timeout", undefined, { cause });
    if (cause instanceof EnrollmentChallengeError) throw cause;
    throw new EnrollmentChallengeError("Ownership challenge request could not be completed.", "request_failed", undefined, { cause });
  }
}
