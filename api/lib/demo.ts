import { computeRpSignatureMessage, signRequest } from "@worldcoin/idkit-core/signing";
import { hexToBytes, verifyMessage, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEMO_ACTION, DEMO_MAX_BODY_BYTES, DEMO_REQUEST_PATH, DEMO_TTL_SECONDS, DEMO_VERIFY_PATH,
  isDemoRpContext, isRecord, type DemoRequest, type DemoRpContext,
} from "../../config/demo";
import { isAllowedOrigin, type ProtocolEnvironment } from "../../config/environment";

type DemoSettings = { appId: DemoRequest["app_id"]; rpId: string; signingKey: Hex; verifyUrl: URL };

export async function handleDemoApi(request: Request, environment: ProtocolEnvironment, bindings: object): Promise<Response> {
  const url = new URL(request.url);
  if (environment !== "staging" || !isAllowedOrigin(environment, url.origin) || request.method !== "POST" ||
    (url.pathname !== DEMO_REQUEST_PATH && url.pathname !== DEMO_VERIFY_PATH)) return problem(404, "Not found");
  if (request.headers.get("Origin") !== url.origin) return problem(403, "Demo requests must come from this origin");
  const settings = demoSettings(bindings);
  if (!settings) return problem(503, "The staging demo RP is not configured");

  if (url.pathname === DEMO_REQUEST_PATH) {
    const signed = signRequest({ action: DEMO_ACTION, signingKeyHex: settings.signingKey, ttl: DEMO_TTL_SECONDS });
    return Response.json({
      app_id: settings.appId,
      rp_context: {
        rp_id: settings.rpId, nonce: signed.nonce, signature: signed.sig,
        created_at: signed.createdAt, expires_at: signed.expiresAt,
      },
    });
  }

  let body: unknown;
  try {
    const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    body = await readJson(request, deadline);
  } catch {
    return problem(400, "Invalid demo proof request");
  }
  if (!isRecord(body) || !isDemoRpContext(body.rp_context) || !isRecord(body.result)) {
    return problem(400, "Invalid demo proof request");
  }
  const { rp_context: context, result } = body;
  const selfie = demoProofItem(result);
  if (!selfie || result.protocol_version !== "4.0" || result.environment !== "staging" ||
    result.action !== DEMO_ACTION || result.nonce !== context.nonce || result.session_id != null ||
    !await matchesIssuedRequest(context, settings)) {
    return problem(400, "The proof does not match this demo request");
  }

  try {
    const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const response = await fetch(settings.verifyUrl, {
      method: "POST", redirect: "error", signal: deadline,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocol_version: "4.0", min_protocol_version: "4.0", environment: "staging",
        action: DEMO_ACTION, nonce: context.nonce, responses: [selfie],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429 || response.status >= 500) return problem(502, "The staging verifier is unavailable");
      return problem(422, "The staging verifier rejected this proof");
    }
    const verdict = await readJson(response, deadline);
    if (!isRecord(verdict) || verdict.success !== true) return problem(422, "The staging verifier rejected this proof");
    return Response.json({ success: true });
  } catch {
    return problem(502, "The staging verifier is unavailable");
  }
}

function demoProofItem(result: Record<string, unknown>) {
  if (!Array.isArray(result.responses) || result.responses.length !== 1) return;
  const item: unknown = result.responses[0];
  if (!isRecord(item) || item.identifier !== "selfie" || item.issuer_schema_id !== 11 ||
    !Array.isArray(item.proof) || item.proof.length !== 5 ||
    !item.proof.every(value => typeof value === "string" && /^\d{1,78}$/.test(value)) ||
    typeof item.nullifier !== "string" || !/^0x[a-f0-9]{64}$/.test(item.nullifier) ||
    typeof item.expires_at_min !== "number" || !Number.isSafeInteger(item.expires_at_min) || item.expires_at_min < 0 ||
    typeof item.sybil_score !== "number" || !Number.isSafeInteger(item.sybil_score) || item.sybil_score < 0 ||
    (item.signal_hash !== undefined && (typeof item.signal_hash !== "string" || !/^0x[a-f0-9]{64}$/.test(item.signal_hash)))) return;
  const { identifier, issuer_schema_id, proof, nullifier, expires_at_min, sybil_score, signal_hash } = item;
  return { identifier, issuer_schema_id, proof, nullifier, expires_at_min, sybil_score, signal_hash };
}

async function matchesIssuedRequest(context: DemoRpContext, settings: DemoSettings): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (context.rp_id !== settings.rpId || context.created_at > now || context.expires_at <= now ||
    context.expires_at - context.created_at !== DEMO_TTL_SECONDS) return false;
  try {
    const address = privateKeyToAccount(settings.signingKey).address;
    const message = computeRpSignatureMessage(hexToBytes(context.nonce), context.created_at, context.expires_at, DEMO_ACTION);
    return await verifyMessage({ address, message: { raw: message }, signature: context.signature });
  } catch {
    return false;
  }
}

function demoSettings(bindings: object): DemoSettings | undefined {
  const values = bindings as Partial<Record<"DEMO_APP_ID" | "DEMO_RP_ID" | "DEMO_RP_SIGNING_KEY" | "DEMO_VERIFY_ORIGIN", unknown>>;
  const { DEMO_APP_ID: appId, DEMO_RP_ID: rpId, DEMO_RP_SIGNING_KEY: signingKey, DEMO_VERIFY_ORIGIN: verifyOrigin } = values;
  if (typeof appId !== "string" || !/^app_[a-f0-9]{32}$/.test(appId) ||
    typeof rpId !== "string" || !/^rp_[a-f0-9]{1,16}$/.test(rpId) ||
    typeof signingKey !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(signingKey) || typeof verifyOrigin !== "string") return;
  try {
    const url = new URL(verifyOrigin);
    if (url.protocol !== "https:" || url.origin !== verifyOrigin) return;
    return { appId: appId as DemoRequest["app_id"], rpId, signingKey: signingKey as Hex, verifyUrl: new URL(`/api/v4/verify/${rpId}`, url) };
  } catch {
    return undefined;
  }
}

async function readJson(message: Request | Response, signal: AbortSignal): Promise<unknown> {
  if (message.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json" ||
    Number(message.headers.get("Content-Length")) > DEMO_MAX_BODY_BYTES || !message.body) throw new Error("Invalid JSON body");
  const buffer = new Uint8Array(DEMO_MAX_BODY_BYTES);
  const reader = message.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let offset = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (value.byteLength > buffer.byteLength - offset) throw new Error("JSON body exceeds the limit");
      buffer.set(value, offset);
      offset += value.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer.subarray(0, offset))) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

function problem(status: number, error: string) {
  return Response.json({ error }, { status });
}
