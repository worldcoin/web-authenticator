import { bytesToHex, type Hex } from "viem";
import { DEMO_ACTION_PREFIX, DEMO_PATH, DEMO_TTL_SECONDS, type DemoRequest } from "../../config/demo";
import type { DemoAttempt } from "./demo";
import type { IncomingRequest } from "./incoming-request";

// TODO: Exploration-only stand-in for the staging demo backend; do not merge to main.
// Localhost has no demo API or RP signing key, so /demo builds its Selfie Check request here and /verify
// loads it from memory, skipping the bridge and the RP signature check. The flow after the consent screen
// is the real one: passkey, then PoseGuard capture only (configureDemoEnrollment never submits over http).

const PREVIEW_APP_ID: DemoRequest["app_id"] = `app_${"0".repeat(32)}`;
const PREVIEW_RP_ID = "rp_0000000000000000";
const previews = new Map<string, IncomingRequest>();

export function isDemoPreview(location: Pick<Location, "protocol" | "hostname"> = window.location): boolean {
  return location.protocol === "http:" && location.hostname === "localhost";
}

export function startDemoPreview(): DemoAttempt {
  const bridgeId = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  const config: DemoRequest = {
    app_id: PREVIEW_APP_ID,
    action: `${DEMO_ACTION_PREFIX}${crypto.randomUUID()}`,
    rp_context: {
      rp_id: PREVIEW_RP_ID, nonce: randomHex(32), created_at: createdAt,
      expires_at: createdAt + DEMO_TTL_SECONDS, signature: `0x${"0".repeat(130)}`,
    },
  };
  const returnUrl = new URL(DEMO_PATH, window.location.origin).href;
  const query = `i=${bridgeId}&k=preview`;
  const noBridge = () => { throw new Error("The local demo preview has no bridge."); };
  previews.set(bridgeId, previewRequest(config, bridgeId, returnUrl));
  return {
    config, returnUrl, query, bridgeId,
    request: {
      connectorURI: new URL(`/verify?${query}`, window.location.origin).href, requestId: bridgeId,
      pollOnce: noBridge, pollUntilCompletion: noBridge, getDebugReport: noBridge,
    },
  };
}

/** The preview request this tab created for the /verify URL, or undefined for any other request. */
export function loadDemoPreview(href: string): IncomingRequest | undefined {
  if (!isDemoPreview()) return;
  const bridgeId = new URL(href).searchParams.get("i");
  return bridgeId === null ? undefined : previews.get(bridgeId);
}

function previewRequest(config: DemoRequest, bridgeId: string, returnUrl: string): IncomingRequest {
  const context = config.rp_context;
  const unavailable = async () => { throw new Error("The local demo preview cannot send proofs."); };
  return {
    proof: {
      id: crypto.randomUUID(), version: 1, proof_type: "uniqueness", rp_id: context.rp_id, oprf_key_id: "preview",
      nonce: context.nonce, signature: context.signature, created_at: context.created_at, expires_at: context.expires_at,
      action: randomHex(32), session_id: null, proof_requests: [{ identifier: "selfie", issuer_schema_id: 11 }],
    },
    bridgeRequestId: bridgeId,
    label: context.rp_id,
    appId: config.app_id,
    actionLabel: config.action,
    returnUrl,
    validate: async () => {},
    deliver: unavailable,
    cancel: async () => {},
  };
}

function randomHex(bytes: number): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
