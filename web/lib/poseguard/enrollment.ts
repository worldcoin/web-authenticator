import type { SelfieCaptureFailure } from "@worldcoin/walletkit-web";
import { ENVIRONMENTS, parsePoseGuardTestMode, type SelfieEnrollmentPolicy } from "../../../config/environment";
import { abortable, pause } from "../async";
import { currentProtocolEnvironment } from "../environment";
import { EnrollmentCaptureSchema, validateEnrollmentCapture } from "../enrollment-contract";
import { logPoseGuardEvent, logPoseGuardStep } from "../flow-logging";
import { INITIAL_CAPTURE_STATE, type CaptureState } from "../selfie-capture";
import {
  getEnrollmentAuthorization, pollEnrollment, SignupServiceError, submitEnrollment,
  type EnrollmentAuthorization, type EnrollmentReceipt, type EnrollmentResult,
} from "../signup-service";
import { WalletOpenError } from "../wallet-errors";
import type { RequestWalletSession } from "../wallet-session";
import type { WalletKit } from "../walletkit";
import { collectPoseGuardImages, preparePoseGuardCamera } from "./capture";
import type { PoseGuardImages } from "./types";

const TEST_CHALLENGE_ID = "00000000-0000-4000-8000-000000000001";
const TEST_ATTESTATION_HEADER = btoa("poseguard test attestation");
// A new account's leaf reaches the indexer's tree after its database row; about 47 s in total.
const INDEXER_SYNC_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000, 8_000];

type PoseGuardAuthorize = (identity: EnrollmentReceipt, signal: AbortSignal, wallet: WalletKit, factor: string) => Promise<EnrollmentAuthorization>;

export type PoseGuardSignup = {
  policy: SelfieEnrollmentPolicy;
  endpoint: string;
} & (
  | { mode: "test" | "staging" }
  | {
    mode: "production"; // Names the flow, not environment.
    saveCredential?: true;
    authorize: PoseGuardAuthorize;
  }
);

export type PoseGuardOutcome = EnrollmentResult["state"] | "pending";

export type RunPoseGuard = (
  video: HTMLVideoElement,
  signal: AbortSignal,
  update: (state: CaptureState) => void,
) => Promise<PoseGuardOutcome>;

export function configuredPoseGuardSignup(): PoseGuardSignup | undefined {
  const environment = currentProtocolEnvironment();
  const { appOrigin, signupServiceOrigin, selfieEnrollment: policy } = ENVIRONMENTS[environment];
  if (environment !== "staging" || window.location.origin !== appOrigin || !policy) return;

  const endpoint = new URL("/api/v2/identity", signupServiceOrigin).href;
  if (parsePoseGuardTestMode(import.meta.env.VITE_POSEGUARD_TEST_MODE, environment)) {
    return { policy, endpoint, mode: "test" };
  }

  const path = policy.authorizationPath;
  // Without an authorization provider, the staging issuer accepts the attested capture on its own.
  if (!path) return { policy, endpoint, mode: "staging" };
  return {
    policy, endpoint, mode: "production",
    authorize: (identity, signal) => getEnrollmentAuthorization(path, identity, signal),
  };
}

/** Whether a completed enrollment leaves the issued credential in the wallet. */
export function storesCredential(signup: PoseGuardSignup): boolean {
  return signup.mode === "staging" || (signup.mode === "production" && signup.saveCredential === true);
}

export function createPoseGuardEnrollment(
  session: RequestWalletSession,
  signup: PoseGuardSignup,
  requestSignal: AbortSignal,
  prepareCamera = preparePoseGuardCamera,
  indexerSyncDelays = INDEXER_SYNC_DELAYS_MS,
): RunPoseGuard {
  let receipt: EnrollmentReceipt | undefined;
  let owner: { wallet: WalletKit; factor: string } | undefined;
  let saved = false;
  let savePromise: Promise<void> | undefined;
  let inFlight = false;
  return async (video, viewSignal, update) => {
    if (inFlight) throw new Error("A PoseGuard attempt is already running.");
    inFlight = true;
    const signal = AbortSignal.any([viewSignal, requestSignal]);
    const signupOptions = { endpoint: signup.endpoint, signal };
    try {
      signal.throwIfAborted();
      if (saved) return "completed";
      if (savePromise) {
        update(checking());
        return await waitForSave(savePromise, signal);
      }
      if (!receipt) {
        const { capture, identity, wallet, blindingFactor } =
          await capturePoseGuard(session, signup.policy, video, signal, update, prepareCamera, indexerSyncDelays);
        let authorization: EnrollmentAuthorization | "staging" = "staging";
        if (signup.mode === "production") {
          update(checking());
          authorization = await abortable(signup.authorize(identity, signal, wallet, blindingFactor), signal);
        } else if (signup.mode === "test") {
          authorization = { challengeId: TEST_CHALLENGE_ID, proofCbor: Uint8Array.of(0xa0) };
        }
        try {
          signal.throwIfAborted();
          update(checking());
          // Keep the capture ID even if the server accepted the PUT and the response was lost.
          receipt = identity;
          if (storesCredential(signup)) owner = { wallet, factor: blindingFactor };
          const evidence = signup.mode === "test" ? { ...capture, attestation_header: TEST_ATTESTATION_HEADER } : capture;
          receipt = await logPoseGuardStep("signup_submit", () => submitEnrollment(evidence, authorization, signupOptions));
        } catch (error) {
          if (!signal.aborted && (error instanceof TypeError ||
            (error instanceof SignupServiceError && error.status !== undefined &&
              error.status >= 400 && error.status < 500 && error.status !== 408))) receipt = undefined;
          throw error;
        } finally {
          if (authorization !== "staging") authorization.proofCbor.fill(0);
        }
      }

      update(checking());
      try {
        const result = await pollEnrollment(receipt, signupOptions);
        if (result.state !== "completed") return result.state;
        const { credential } = result;
        if (!owner) {
          credential.fill(0);
          return "completed";
        }
        const { wallet, factor } = owner;
        // The write can outlive the wait and owns the credential bytes until it settles.
        savePromise = (async () => {
          try {
            update(checking());
            signal.throwIfAborted();
            await wallet.storeCredential(credential, factor, undefined, 11n);
            saved = true;
            owner = undefined;
            savePromise = undefined;
          } finally {
            credential.fill(0);
          }
        })();
        return await waitForSave(savePromise, signal);
      } catch (error) {
        if (error instanceof SignupServiceError && error.code === "polling_timeout") return "pending";
        throw error;
      }
    } finally {
      inFlight = false;
    }
  };

  async function waitForSave(operation: Promise<void>, signal: AbortSignal): Promise<"completed" | "pending"> {
    const timeout = AbortSignal.timeout(30_000);
    try {
      await abortable(operation, AbortSignal.any([signal, timeout]));
      return "completed";
    } catch (error) {
      signal.throwIfAborted();
      if (timeout.aborted && error === timeout.reason) return "pending";
      savePromise = undefined;
      throw error;
    }
  }
}

async function capturePoseGuard(
  session: RequestWalletSession,
  policy: SelfieEnrollmentPolicy,
  video: HTMLVideoElement,
  signal: AbortSignal,
  update: (state: CaptureState) => void,
  prepareCamera: typeof preparePoseGuardCamera,
  indexerSyncDelays: readonly number[],
) {
  signal.throwIfAborted();
  update({ ...INITIAL_CAPTURE_STATE, title: "Getting ready", hint: "" });
  const wallet = await logPoseGuardStep("wallet_ready", async () => {
    const state = await abortable(session.ready, signal);
    if ("error" in state) throw state.error;
    return state.wallet;
  });
  const { sub, blindingFactor } = await logPoseGuardStep("prepare_credential", () =>
    prepareEnrollmentCredential(wallet, signal, update, indexerSyncDelays));
  const custody = await abortable(crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]), signal);
  if (!("publicKey" in custody)) throw new Error("Could not prepare a custody key pair.");
  const publicKey = new Uint8Array(await abortable(crypto.subtle.exportKey("raw", custody.publicKey), signal));

  // Bound permission and model startup separately from the enclave's capture window.
  update({ ...INITIAL_CAPTURE_STATE, title: "Getting ready", hint: "" });
  const start = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  const cameraScope = new AbortController();
  const camera = await abortable(prepareCamera(video, AbortSignal.any([signal, cameraScope.signal]), update), start).catch(error => {
    cameraScope.abort(error);
    throw error;
  });
  let images: PoseGuardImages | undefined;
  const enrollmentSignal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  try {
    update({ phase: "checking", title: "Getting ready", hint: "", progress: 0, cameraReady: true });
    const requestedAt = performance.now();
    const operation = wallet.enrollSelfieWithPoseGuard(
      JSON.stringify({ endpoint: policy.endpoint, releases: policy.releases }),
      sub, publicKey, async (prompt, callbackSignal) => {
        logPoseGuardEvent("poseguard_prompt", { durationMs: Math.round(performance.now() - requestedAt) });
        const captureSignal = AbortSignal.any([enrollmentSignal, camera.signal, callbackSignal]);
        const captured = await collectPoseGuardImages(prompt, captureSignal, camera.readFrame, update);
        if (captureSignal.aborted) {
          clearImages(captured);
          captureSignal.throwIfAborted();
        }
        images = captured;
        update(checking());
        camera.close();
        return images;
      }, enrollmentSignal,
    ).then(result => {
      // This flow saves the signed credential separately from the encrypted custody package.
      if (result.status === "success") result.enrollment.encryptedCustody.fill(0);
      return result;
    });
    const result = await abortable(operation, enrollmentSignal);
    enrollmentSignal.throwIfAborted();
    if (result.status !== "success") throw teeRejection(result);
    if (!images) throw new Error("WalletKit finished before collecting the PoseGuard captures.");
    const capture = EnrollmentCaptureSchema.parse({
      fields: result.enrollment.fields,
      attestation_header: result.enrollment.attestationHeader,
    });
    const identity = validateEnrollmentCapture(capture);
    if (identity.sub !== sub) throw new Error("The selfie enrollment does not match this wallet.");
    if (import.meta.env.DEV) {
      const encoder = new TextEncoder();
      logPoseGuardEvent("poseguard_bundle_validated", {
        fieldCount: capture.fields.length,
        multipartFieldBytes: Object.fromEntries(capture.fields.map(({ name, value }) => [name, encoder.encode(value).byteLength])),
        nitroHeaderBytes: capture.attestation_header.length,
        walletSubjectMatches: true,
      });
    }
    return { capture, identity, wallet, blindingFactor };
  } finally {
    camera.close();
    if (images) clearImages(images);
  }
}

async function prepareEnrollmentCredential(
  wallet: WalletKit,
  signal: AbortSignal,
  update: (state: CaptureState) => void,
  syncDelays: readonly number[],
) {
  const started = performance.now();
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await abortable(wallet.prepareCredential(11n), signal);
    } catch (error) {
      const pending = indexerSyncPending(error);
      if (!pending) throw error;
      logPoseGuardEvent("poseguard_indexer_sync", { attempt: attempt + 1, code: pending, elapsedMs: Math.round(performance.now() - started) });
      const delay = syncDelays[attempt];
      if (delay === undefined) throw new WalletOpenError("World ID is syncing. Try again in a moment.", { cause: error });
      if (attempt === 0) update({ ...INITIAL_CAPTURE_STATE, title: "Waiting for your World ID to sync", hint: "" });
      // Jitter keeps clients that registered together from retrying in lockstep.
      await pause(delay * (0.75 + Math.random() * 0.5), signal);
    }
  }
}

/** The indexer code when its tree has not yet caught up with a new account, otherwise undefined. */
function indexerSyncPending(error: unknown): "invalid_leaf_index" | "locked" | undefined {
  const prefix = "network_error at indexer: ";
  if (!(error instanceof Error) || error.name !== "WalletKitError" ||
    !("code" in error) || error.code !== "NetworkError" || !error.message.startsWith(prefix)) return;
  const body = error.message.slice(prefix.length).split(" (NetworkError {", 1)[0];
  if (/"code"\s*:\s*"invalid_leaf_index"/.test(body) && /"message"\s*:\s*"Leaf index out of range\."/.test(body)) return "invalid_leaf_index";
  if (/"code"\s*:\s*"locked"/.test(body) && /"message"\s*:\s*"Insertion is still pending\."/.test(body)) return "locked";
}

function teeRejection(result: SelfieCaptureFailure): Error {
  if (result.reason === "challenge") {
    const step = result.index + 2;
    logPoseGuardEvent("poseguard_rejected", { step, reason: result.challengeReason });
    return new Error(`Capture rejected at step ${step}. Try again.`);
  }
  logPoseGuardEvent("poseguard_rejected", { reason: result.reason });
  if (result.reason === "quality_rejected") {
    return new Error("Center frame failed the quality check. Keep your face in view and try again.");
  }
  return new Error("PoseGuard rejected the captures. Try again.");
}

function clearImages(images: PoseGuardImages) {
  images.centralPng.fill(0);
  for (const image of images.captures) image.fill(0);
}

// Everything after capture shows one message, so the screen doesn't step through internal stages.
function checking(): CaptureState {
  return { phase: "checking", title: "Processing liveness", hint: "This might take a few seconds", progress: 1, cameraReady: false };
}
