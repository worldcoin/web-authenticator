import { computeRpSignatureMessage, signRequest } from "@worldcoin/idkit-core/signing";
import { hexToBytes, verifyMessage, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import {
  DEMO_ACTION, DEMO_MAX_BODY_BYTES, DEMO_REQUEST_PATH, DEMO_TTL_SECONDS, DEMO_VERIFY_PATH,
  DemoHex32Schema, DemoRequestSchema, DemoRpContextSchema, DemoVerificationSuccessSchema, type DemoRequest, type DemoRpContext,
} from "../../config/demo";
import { isAllowedOrigin, type ProtocolEnvironment } from "../../config/environment";

type DemoSettings = { appId: DemoRequest["app_id"]; rpId: string; signingKey: Hex; verifyUrl: URL };

const DemoSettingsSchema = z.object({
  DEMO_APP_ID: DemoRequestSchema.shape.app_id,
  DEMO_RP_ID: DemoRpContextSchema.shape.rp_id,
  DEMO_RP_SIGNING_KEY: z.templateLiteral(["0x", z.string().regex(/^[a-fA-F0-9]{64}$/)]),
  DEMO_VERIFY_ORIGIN: z.string().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value;
    } catch {
      return false;
    }
  }),
});

const DemoVerifyRequestSchema = z.object({
  rp_context: DemoRpContextSchema,
  result: z.looseObject({}),
});

const DemoProofResultSchema = z.object({
  protocol_version: z.literal("4.0"),
  environment: z.literal("staging"),
  action: z.literal(DEMO_ACTION),
  nonce: DemoHex32Schema,
  session_id: z.null().optional(),
  responses: z.tuple([z.object({
    identifier: z.literal("selfie"),
    issuer_schema_id: z.literal(11),
    proof: z.array(z.string().regex(/^\d{1,78}$/)).length(5),
    nullifier: DemoHex32Schema,
    expires_at_min: z.int().nonnegative(),
    sybil_score: z.int().nonnegative(),
    signal_hash: DemoHex32Schema.optional(),
  })]),
});

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
  const parsed = DemoVerifyRequestSchema.safeParse(body);
  if (!parsed.success) return problem(400, "Invalid demo proof request");
  const { rp_context: context, result } = parsed.data;
  const proof = DemoProofResultSchema.safeParse(result);
  if (!proof.success || proof.data.nonce !== context.nonce || !await matchesIssuedRequest(context, settings)) {
    return problem(400, "The proof does not match this demo request");
  }

  try {
    const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const response = await fetch(settings.verifyUrl, {
      method: "POST", redirect: "error", signal: deadline,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocol_version: "4.0", min_protocol_version: "4.0", environment: "staging",
        action: DEMO_ACTION, nonce: context.nonce, responses: proof.data.responses,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429 || response.status >= 500) return problem(502, "The staging verifier is unavailable");
      return problem(422, "The staging verifier rejected this proof");
    }
    const verdict = await readJson(response, deadline);
    if (!DemoVerificationSuccessSchema.safeParse(verdict).success) return problem(422, "The staging verifier rejected this proof");
    return Response.json({ success: true });
  } catch {
    return problem(502, "The staging verifier is unavailable");
  }
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
  const parsed = DemoSettingsSchema.safeParse(bindings);
  if (!parsed.success) return;
  const { DEMO_APP_ID: appId, DEMO_RP_ID: rpId, DEMO_RP_SIGNING_KEY: signingKey, DEMO_VERIFY_ORIGIN: verifyOrigin } = parsed.data;
  return { appId, rpId, signingKey, verifyUrl: new URL(`/api/v4/verify/${rpId}`, verifyOrigin) };
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
