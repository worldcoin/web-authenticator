import { initializeWalletKit, type WalletKit } from "@worldcoin/walletkit-web";
import { abortable } from "./async";
import { logFlowStep } from "./flow-logging";

/** Covers WASM worker start-up, attestation, upload and extraction. */
export const SELFIE_EXTRACTION_TIMEOUT_MS = 60_000;
const POLICY_TIMEOUT_MS = 5_000;
const MAX_POLICY_BYTES = 8192;

type Rejection = "invalid_image" | "quality_rejected" | "extraction_failed" | "invalid_request";
export type SelfieEmbeddingResult =
  | { status: "success"; embedding: { embedding: string; embeddingType: string; embeddingVersion: string; embeddingInferenceBackend: string } }
  | { status: "failed"; reason: Rejection };

function parseResult(value: unknown): SelfieEmbeddingResult {
  if (typeof value !== "object" || value === null || !("status" in value)) throw new Error("Invalid selfie extraction response.");
  if (value.status === "failed" && "reason" in value && typeof value.reason === "string" &&
    ["invalid_image", "quality_rejected", "extraction_failed", "invalid_request"].includes(value.reason)) {
    return { status: "failed", reason: value.reason as Rejection };
  }
  if (value.status === "success" && "embedding" in value && typeof value.embedding === "object" && value.embedding !== null) {
    const e = value.embedding;
    if ("embedding" in e && typeof e.embedding === "string" && e.embedding.length > 0 && e.embedding.length <= 4096 &&
      "embeddingType" in e && typeof e.embeddingType === "string" && e.embeddingType.length > 0 && e.embeddingType.length <= 128 &&
      "embeddingVersion" in e && typeof e.embeddingVersion === "string" && e.embeddingVersion.length > 0 && e.embeddingVersion.length <= 128 &&
      "embeddingInferenceBackend" in e && typeof e.embeddingInferenceBackend === "string" && e.embeddingInferenceBackend.length > 0 && e.embeddingInferenceBackend.length <= 128) {
      return { status: "success", embedding: { embedding: e.embedding, embeddingType: e.embeddingType, embeddingVersion: e.embeddingVersion, embeddingInferenceBackend: e.embeddingInferenceBackend } };
    }
  }
  throw new Error("Invalid selfie extraction response.");
}

// Pending worldcoin/walletkit#604. Replace this narrow RPC contract with its
// published SDK types when upgrading; the currently pinned SDK rejects the call.
async function requestExtraction(client: WalletKit, policy: string, bytes: Uint8Array): Promise<SelfieEmbeddingResult> {
  const api = client as WalletKit & { extractSelfieEmbedding?: (policy: string, image: Uint8Array) => Promise<unknown> };
  if (typeof api.extractSelfieEmbedding !== "function") throw new DOMException("WalletKit selfie extraction requires walletkit#604.", "NotSupportedError");
  try {
    return parseResult(await api.extractSelfieEmbedding(policy, bytes));
  } catch (error) {
    if (error instanceof Error && error.message === "Unknown function: extractSelfieEmbedding") {
      throw new DOMException("WalletKit selfie extraction requires walletkit#604.", "NotSupportedError");
    }
    throw error;
  }
}

/** The enclave answered but could not use this image. Other failures are transport, attestation or timeout. */
export class SelfieRejectedError extends Error {
  override readonly name = "SelfieRejectedError";
  constructor(readonly reason: Rejection) {
    super(`Selfie rejected by the enclave: ${reason}`);
  }
}

/** Non-sensitive result metadata; the encoded vector never leaves this module. */
export type SelfieEmbeddingSummary = {
  embeddingType: string;
  embeddingVersion: string;
  embeddingInferenceBackend: string;
  encodedLength: number;
};

/** The trusted release policy as client config JSON, or null when the server has enrollment switched off. */
export async function fetchSelfieEnrollmentPolicy(signal: AbortSignal): Promise<string | null> {
  const response = await fetch("/api/selfie-enrollment", {
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(POLICY_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error(`Selfie enrollment policy request failed (${response.status})`);
  const text = await response.text();
  if (text.length > MAX_POLICY_BYTES) throw new Error("Selfie enrollment policy is too large");
  const body = JSON.parse(text) as { enabled?: unknown; policy?: unknown };
  if (body.enabled === false) return null;
  if (body.enabled !== true || typeof body.policy !== "object" || body.policy === null) throw new Error("Selfie enrollment policy is malformed");
  return JSON.stringify(body.policy);
}

export type SelfieEnrollmentService = {
  policy: (signal: AbortSignal) => Promise<string | null>;
  extract: (policy: string, image: Blob, signal: AbortSignal) => Promise<SelfieEmbeddingSummary>;
};

export const selfieEnrollment: SelfieEnrollmentService = {
  policy: signal => logFlowStep("selfie.enrollment_policy", () => fetchSelfieEnrollmentPolicy(signal)),
  extract: (policy, image, signal) => extractSelfieEmbedding(policy, image, signal),
};

/**
 * Seals one image for an attested enclave and returns embedding metadata.
 * WalletKit has no per-call cancellation, so abort and completion terminate the worker.
 */
export async function extractSelfieEmbedding(
  policy: string,
  image: Blob,
  signal: AbortSignal,
  initialize: typeof initializeWalletKit = initializeWalletKit,
): Promise<SelfieEmbeddingSummary> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(SELFIE_EXTRACTION_TIMEOUT_MS)]);
  const bytes = new Uint8Array(await image.arrayBuffer());
  let client: WalletKit | undefined;
  const stop = () => client?.terminate();
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    client = await logFlowStep("walletkit.worker_initialize", () => initialize({ signal }));
    signal.throwIfAborted();
    const result = await logFlowStep("selfie.extract_embedding", () => abortable(requestExtraction(client!, policy, bytes), signal));
    if (result.status !== "success") {
      // eslint-disable-next-line no-console -- Typed enclave verdict only; no image or embedding material.
      console.warn("selfie_extraction_rejected", { reason: result.reason });
      throw new SelfieRejectedError(result.reason);
    }
    const { embedding, embeddingType, embeddingVersion, embeddingInferenceBackend } = result.embedding;
    const summary = { embeddingType, embeddingVersion, embeddingInferenceBackend, encodedLength: embedding.length };
    // eslint-disable-next-line no-console -- Staging integration check: model metadata and encoded size, never the vector.
    console.info("selfie_extraction_succeeded", summary);
    return summary;
  } finally {
    signal.removeEventListener("abort", stop);
    bytes.fill(0);
    client?.terminate();
  }
}
