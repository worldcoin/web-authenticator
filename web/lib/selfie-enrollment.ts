import { initializeWalletKit, type SelfieEmbeddingResult, type WalletKit } from "@worldcoin/walletkit-web";
import { abortable } from "./async";
import { logFlowStep } from "./flow-logging";

/** Covers WASM worker start-up, attestation, upload and extraction. */
export const SELFIE_EXTRACTION_TIMEOUT_MS = 60_000;
const POLICY_TIMEOUT_MS = 5_000;
const MAX_POLICY_BYTES = 8192;

type Rejection = Extract<SelfieEmbeddingResult, { status: "failed" }>["reason"];

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
  closeOnCompletion = true,
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
    const result = await logFlowStep("selfie.extract_embedding", () => abortable(client!.extractSelfieEmbedding(policy, bytes), signal));
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
    if (closeOnCompletion) client?.terminate();
  }
}
