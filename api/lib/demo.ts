import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { computeRpSignatureMessage, signRequest } from "@worldcoin/idkit-core/signing";
import {
  BaseError, createPublicClient, encodeFunctionData, ExecutionRevertedError, hexToBytes, http, isAddressEqual,
  maxUint256, parseAbi, verifyMessage, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { getNodeError } from "viem/utils";
import { z } from "zod";
import {
  DEMO_ACTION, DEMO_MAX_BODY_BYTES, DEMO_REQUEST_PATH, DEMO_TTL_SECONDS, DEMO_VERIFY_PATH,
  DemoHex32Schema, DemoRequestSchema, DemoRpContextSchema, type DemoRequest, type DemoRpContext,
} from "../../config/demo";
import { isAllowedOrigin, type ProtocolEnvironment } from "../../config/environment";

type DemoSettings = { appId: DemoRequest["app_id"]; rpId: string; signingKey: Hex; rpcUrl: string };
type DemoSelfieResponse = z.infer<typeof DemoProofResultSchema>["responses"][0];

// World Chain staging proxies from world-id-protocol/contracts/deployments/core/staging.json.
const STAGING_WORLD_ID_VERIFIER = "0x703a6316c975DEabF30b637c155edD53e24657DB";
const STAGING_WORLD_ID_REGISTRY = "0x8556d07D75025f286fe757C7EeEceC40D54FA16D";
const WORLD_ID_VERIFIER_ABI = parseAbi([
  "function getWorldIDRegistry() view returns (address)",
  "function verify(uint256 nullifier, uint256 action, uint64 rpId, uint256 nonce, uint256 signalHash, uint64 expiresAtMin, uint64 issuerSchemaId, uint256 credentialGenesisIssuedAtMin, uint256[5] zeroKnowledgeProof) view",
]);
const ACTION_HASH = BigInt(hashSignal(DEMO_ACTION));
const VERIFY_TIMEOUT_MS = 10_000;

const DemoSettingsSchema = z.object({
  DEMO_APP_ID: DemoRequestSchema.shape.app_id,
  DEMO_RP_ID: DemoRpContextSchema.shape.rp_id,
  IDKIT_EXAMPLE_RP_SIGNING_KEY: z.templateLiteral(["0x", z.string().regex(/^[a-fA-F0-9]{64}$/)]),
  DEMO_WORLDCHAIN_RPC_URL: z.string().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && value === value.trim() && !url.username && !url.password;
    } catch {
      return false;
    }
  }),
});

const DemoVerifyRequestSchema = z.object({
  rp_context: DemoRpContextSchema,
  result: z.looseObject({}),
});

const ProofWordSchema = z.string().regex(/^\d{1,78}$/).transform(BigInt).pipe(z.bigint().max(maxUint256));

const DemoProofResultSchema = z.object({
  protocol_version: z.literal("4.0"),
  environment: z.literal("staging"),
  action: z.literal(DEMO_ACTION),
  nonce: DemoHex32Schema,
  session_id: z.null().optional(),
  responses: z.tuple([z.object({
    identifier: z.literal("selfie"),
    issuer_schema_id: z.literal(11),
    proof: z.tuple([ProofWordSchema, ProofWordSchema, ProofWordSchema, ProofWordSchema, ProofWordSchema]),
    nullifier: DemoHex32Schema,
    expires_at_min: z.int().nonnegative(),
    sybil_score: z.int().nonnegative(),
    signal_hash: DemoHex32Schema.optional(),
    credential_genesis_issued_at_min: z.int().nonnegative().optional(),
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

  return verifySelfieProof(context, proof.data.responses[0], settings, request.signal);
}

async function verifySelfieProof(
  context: DemoRpContext, response: DemoSelfieResponse, settings: DemoSettings, signal: AbortSignal,
): Promise<Response> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(VERIFY_TIMEOUT_MS)]);
  const client = createPublicClient({
    chain: worldchain,
    transport: http(settings.rpcUrl, {
      fetchOptions: { signal: deadline, redirect: "error" },
      maxResponseBodySize: DEMO_MAX_BODY_BYTES,
      retryCount: 0,
      timeout: VERIFY_TIMEOUT_MS,
    }),
  });
  let operation = "read_verifier_registry";
  try {
    // A void eth_call also succeeds at an address with no code.
    const registry = await client.readContract({
      address: STAGING_WORLD_ID_VERIFIER,
      abi: WORLD_ID_VERIFIER_ABI,
      functionName: "getWorldIDRegistry",
    });
    if (!isAddressEqual(registry, STAGING_WORLD_ID_REGISTRY)) throw new Error("Unexpected verifier registry");
    operation = "verify_proof";
    const data = encodeFunctionData({
      abi: WORLD_ID_VERIFIER_ABI,
      functionName: "verify",
      args: [
        BigInt(response.nullifier),
        ACTION_HASH,
        BigInt(`0x${settings.rpId.slice(3)}`),
        BigInt(context.nonce),
        // Protocol 4.0 defaults a missing signal hash to zero.
        BigInt(response.signal_hash ?? 0),
        BigInt(response.expires_at_min),
        BigInt(response.issuer_schema_id),
        BigInt(response.credential_genesis_issued_at_min ?? 0),
        response.proof,
      ],
    });
    const result = await client.request({
      method: "eth_call",
      params: [{ to: STAGING_WORLD_ID_VERIFIER, data }, "latest"],
    });
    if (result !== "0x") throw new Error("Unexpected verifier response");
    return Response.json({ success: true });
  } catch (error) {
    if (operation === "verify_proof" && error instanceof BaseError && getNodeError(error, {}) instanceof ExecutionRevertedError) {
      // eslint-disable-next-line no-console -- Proof rejection without calldata or RPC details.
      console.warn("demo_verify_rejected", { rpId: settings.rpId, verifier: STAGING_WORLD_ID_VERIFIER });
      return problem(422, "The staging verifier rejected this proof");
    }
    const failure: unknown = deadline.aborted ? deadline.reason : error;
    // eslint-disable-next-line no-console -- Log the failure category without calldata or the RPC URL.
    console.error("demo_verify_unavailable", {
      rpId: settings.rpId, verifier: STAGING_WORLD_ID_VERIFIER, operation,
      category: failure instanceof Error ? failure.name : "unknown_error",
    });
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
  const { DEMO_APP_ID: appId, DEMO_RP_ID: rpId, IDKIT_EXAMPLE_RP_SIGNING_KEY: signingKey, DEMO_WORLDCHAIN_RPC_URL: rpcUrl } = parsed.data;
  return { appId, rpId, signingKey, rpcUrl };
}

async function readJson(message: Request, signal: AbortSignal): Promise<unknown> {
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
