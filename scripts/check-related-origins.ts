// Checks that each IdP still authorizes the web authenticator origin that creates and
// unlocks passkeys under its RP ID. If an IdP stops listing an origin, browsers reject
// every create() and get() for that RP ID there, and wallets created under it cannot be
// unlocked. Run with `bun run check:related-origins`.
import { SHARED_RP_PAIRS } from "../web/lib/passkey-rp";

const ATTEMPTS = 3;
const TIMEOUT_MS = 10_000;
const BASE_BACKOFF_MS = 1_000;

type FailureClass = "timeout" | "network" | "redirect" | "http_status" | "content_type" | "invalid_json" | "origin_missing";

class CheckFailure extends Error {
  constructor(readonly failureClass: FailureClass, message: string, readonly retryable: boolean) {
    super(message);
  }
}

async function fetchOrigins(rpId: string): Promise<string[]> {
  let response: Response;
  try {
    // Browsers fetch this document without following redirects.
    response = await fetch(`https://${rpId}/.well-known/webauthn`, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new CheckFailure(timedOut ? "timeout" : "network", timedOut ? `no response within ${TIMEOUT_MS} ms` : String(error), true);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new CheckFailure("redirect", `HTTP ${response.status} to ${response.headers.get("location") ?? "(no location)"}`, false);
  }
  if (!response.ok) {
    throw new CheckFailure("http_status", `HTTP ${response.status}`, response.status >= 500 || response.status === 429);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    throw new CheckFailure("content_type", `content-type ${JSON.stringify(contentType)}`, false);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CheckFailure("invalid_json", "body is not JSON", false);
  }
  const origins = (body as { origins?: unknown } | null)?.origins;
  if (!Array.isArray(origins) || !origins.every(origin => typeof origin === "string")) {
    throw new CheckFailure("invalid_json", "missing string array `origins`", false);
  }
  return origins;
}

async function checkPair(origin: string, rpId: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const origins = await fetchOrigins(rpId);
      if (!origins.includes(origin)) {
        throw new CheckFailure("origin_missing", `lists ${JSON.stringify(origins)}`, false);
      }
      return;
    } catch (error) {
      const failure = error instanceof CheckFailure ? error : new CheckFailure("network", String(error), false);
      if (!failure.retryable || attempt >= ATTEMPTS) {
        throw Object.assign(failure, { attempt });
      }
      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await new Promise(resolve => setTimeout(resolve, backoff + Math.random() * backoff));
    }
  }
}

const results = await Promise.allSettled(SHARED_RP_PAIRS.map(({ origin, rpId }) => checkPair(origin, rpId)));
let failed = 0;
results.forEach((result, index) => {
  const { origin, rpId } = SHARED_RP_PAIRS[index]!;
  if (result.status === "fulfilled") {
    console.log(`ok      ${rpId} authorizes ${origin}`);
    return;
  }
  failed++;
  const failure = result.reason as CheckFailure & { attempt?: number };
  console.error(
    `FAILED  ${rpId} does not authorize ${origin}: failure_class=${failure.failureClass ?? "unknown"} attempts=${failure.attempt ?? 1} ${failure.message}`,
  );
});
if (failed > 0) {
  console.error(`\n${failed} of ${SHARED_RP_PAIRS.length} related-origin checks failed. Browsers will reject passkeys under the affected RP IDs on those origins.`);
  process.exit(1);
}
