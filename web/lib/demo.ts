import type { IDKitRequest } from "@worldcoin/idkit-core";
import { DEMO_ACTION, DEMO_PATH, DEMO_REQUEST_PATH, DEMO_VERIFY_PATH, isDemoRequest, isRecord, type DemoRequest } from "../../config/demo";
import { parseConnector } from "./connector";
import type { IncomingRequest } from "./incoming-request";

export type DemoProofSource = "issued" | "saved";

export type DemoAttempt = {
  request: IDKitRequest;
  config: DemoRequest;
  returnUrl: string;
  query: string;
  bridgeId: string;
};

export async function startDemo(signal: AbortSignal): Promise<DemoAttempt> {
  const config = await postDemo(DEMO_REQUEST_PATH, signal);
  if (!isDemoRequest(config)) throw new Error("The server returned an invalid demo request.");

  const { IDKit, selfieCheck } = await import("@worldcoin/idkit-core");
  signal.throwIfAborted();
  const returnUrl = new URL(DEMO_PATH, window.location.origin).href;
  const request = await IDKit.request({
    ...config,
    environment: "staging",
    action: DEMO_ACTION,
    allow_legacy_proofs: false,
    bridge_url: "https://staging-bridge.worldcoin.org",
    return_to: returnUrl,
    override_connect_base_url: new URL("/verify", window.location.origin).href,
  }).preset(selfieCheck(), { timeout: 15_000, signal }).catch(() => {
    signal.throwIfAborted();
    throw new Error("The staging bridge could not create this request. Try again.");
  });
  const connector = parseConnector(request.connectorURI);
  if (connector?.requestId !== request.requestId) throw new Error("IDKit returned an invalid connector.");
  const url = new URL(request.connectorURI);
  return { config, request, returnUrl, query: url.search.slice(1), bridgeId: connector.requestId };
}

export type DemoHandoff = Pick<DemoAttempt, "config" | "returnUrl" | "bridgeId">;

export function isDemoHandoff(attempt: DemoHandoff, incoming: IncomingRequest): boolean {
  const context = attempt.config.rp_context;
  return incoming.bridgeRequestId === attempt.bridgeId && incoming.appId === attempt.config.app_id &&
    incoming.proof.rp_id === context.rp_id && incoming.proof.nonce === context.nonce &&
    incoming.actionLabel === DEMO_ACTION && incoming.returnUrl === attempt.returnUrl &&
    incoming.proof.proof_requests.length === 1 && incoming.proof.proof_requests[0].issuer_schema_id === 11;
}

export async function verifyDemo(attempt: DemoAttempt, signal: AbortSignal): Promise<void> {
  const timeout = attempt.config.rp_context.expires_at * 1000 - Date.now();
  if (timeout <= 0) throw new Error("This demo request expired. Start a fresh check.");
  const completion = await attempt.request.pollUntilCompletion({ timeout, signal });
  if (!completion.success) {
    throw new Error(completion.error === "timeout" ? "This demo request expired. Start a fresh check."
      : completion.error === "verification_rejected" ? "The check was cancelled."
        : "The demo could not receive a proof. Start a fresh check.");
  }
  const result = await postDemo(DEMO_VERIFY_PATH, signal, { rp_context: attempt.config.rp_context, result: completion.result });
  if (!isRecord(result) || result.success !== true) throw new Error("The relying party could not verify this proof.");
}

async function postDemo(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 503) throw new Error("The staging demo relying party is not configured.");
    if (response.status === 422) throw new Error("The relying party rejected this proof.");
    throw new Error("The demo request could not be completed.");
  }
  return response.json() as Promise<unknown>;
}
