import type { SelfieCaptureFailure } from "@worldcoin/walletkit-web";
import { ENVIRONMENTS, parsePoseGuardTestMode, type SelfieEnrollmentPolicy } from "../../../config/environment";
import { abortable, pause } from "../async";
import { currentProtocolEnvironment } from "../environment";
import { ENROLLMENT_CONTEXT, EnrollmentCaptureSchema, parseEnrollmentChallenge, validateEnrollmentCapture } from "../enrollment-contract";
import { fetchEnrollmentChallenge } from "../enrollment-challenge";
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

type PoseGuardSignup = {
  policy: SelfieEnrollmentPolicy;
  endpoint: string;
} & (
  | { testMode: true }
  | {
    testMode: false;
    saveCredential?: true;
    authorize: (identity: EnrollmentReceipt, signal: AbortSignal, wallet: WalletKit, factor: string) => Promise<EnrollmentAuthorization>;
  }
);

export type PoseGuardOutcome = EnrollmentResult["state"] | "pending" | "captured";

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
    return { policy, endpoint, testMode: true };
  }

  const path = policy.authorizationPath;
  if (!path) return;
  return {
    policy, endpoint, testMode: false,
    authorize: (identity, signal) => getEnrollmentAuthorization(path, identity, signal),
  };
}

export function configureDemoEnrollment(session: RequestWalletSession, signal: AbortSignal): RunPoseGuard {
  const { appOrigin, selfieEnrollment: policy, signupServiceOrigin } = ENVIRONMENTS.staging;
  if (currentProtocolEnvironment() !== "staging" || !policy) {
    throw new WalletOpenError("PoseGuard requires a configured staging TEE release.");
  }
  if (window.location.protocol === "http:") {
    return async (video, viewSignal, update) => {
      await capturePoseGuard(session, policy, video, AbortSignal.any([signal, viewSignal]), update, preparePoseGuardCamera);
      return "captured";
    };
  }
  const challengeUrl = policy.ownershipChallengeUrl;
  if (window.location.origin !== appOrigin || !challengeUrl) {
    throw new WalletOpenError("Credential issuance requires the staging ownership challenge endpoint.");
  }

  return createPoseGuardEnrollment(session, {
    testMode: false,
    saveCredential: true,
    policy,
    endpoint: new URL("/api/v2/identity", signupServiceOrigin).href,
    async authorize(identity, signal, wallet, factor) {
      const challenge = await fetchEnrollmentChallenge({ endpoint: challengeUrl, signal });
      const remaining = Math.min(120_000, Date.parse(challenge.expires_at) - Date.now());
      if (remaining <= 0) throw new Error("The ownership challenge expired. Start a new check.");
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
      const proofCbor = await abortable(wallet.proveCredentialSub(challenge.nonce, ENROLLMENT_CONTEXT, factor, identity.sub), deadline);
      try {
        parseEnrollmentChallenge(challenge);
        return { challengeId: challenge.challenge_id, proofCbor };
      } catch (error) {
        proofCbor.fill(0);
        throw error;
      }
    },
  }, signal);
}

export function createPoseGuardEnrollment(
  session: RequestWalletSession,
  signup: PoseGuardSignup,
  requestSignal: AbortSignal,
  prepareCamera = preparePoseGuardCamera,
): RunPoseGuard {
  let receipt: EnrollmentReceipt | undefined;
  let owner: { wallet: WalletKit; factor: string } | undefined;
  let saved = false;
  let inFlight = false;
  return async (video, viewSignal, update) => {
    if (inFlight) throw new Error("A PoseGuard attempt is already running.");
    inFlight = true;
    const signal = AbortSignal.any([viewSignal, requestSignal]);
    const signupOptions = { endpoint: signup.endpoint, signal };
    try {
      signal.throwIfAborted();
      if (saved) return "completed";
      if (!receipt) {
        const { capture, identity, wallet, blindingFactor } =
          await capturePoseGuard(session, signup.policy, video, signal, update, prepareCamera);
        update(checking("Getting enrollment authorization"));
        const authorization = signup.testMode
          ? { challengeId: TEST_CHALLENGE_ID, proofCbor: Uint8Array.of(0xa0) }
          : await abortable(signup.authorize(identity, signal, wallet, blindingFactor), signal);
        try {
          signal.throwIfAborted();
          update(checking("Submitting to signup-service"));
          // Keep the capture ID even if the server accepted the PUT and the response was lost.
          receipt = identity;
          if (!signup.testMode && signup.saveCredential) owner = { wallet, factor: blindingFactor };
          const evidence = signup.testMode ? { ...capture, attestation_header: TEST_ATTESTATION_HEADER } : capture;
          receipt = await logPoseGuardStep("signup_submit", () => submitEnrollment(evidence, authorization, signupOptions));
        } catch (error) {
          if (!signal.aborted && (error instanceof TypeError ||
            (error instanceof SignupServiceError && error.status !== undefined &&
              error.status >= 400 && error.status < 500 && error.status !== 408))) receipt = undefined;
          throw error;
        } finally {
          authorization.proofCbor.fill(0);
        }
      }

      update(checking("Checking signup-service enrollment status"));
      try {
        const result = await pollEnrollment(receipt, signupOptions);
        if (result.state === "completed") {
          try {
            if (owner) {
              update(checking("Saving your Selfie Check credential"));
              const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
              await abortable(owner.wallet.storeCredential(result.credential, owner.factor, undefined, 11n), deadline);
              saved = true;
              owner = undefined;
            }
          } finally {
            result.credential.fill(0);
          }
        }
        return result.state;
      } catch (error) {
        if (error instanceof SignupServiceError && error.code === "polling_timeout") return "pending";
        throw error;
      }
    } finally {
      inFlight = false;
    }
  };
}

async function capturePoseGuard(
  session: RequestWalletSession,
  policy: SelfieEnrollmentPolicy,
  video: HTMLVideoElement,
  signal: AbortSignal,
  update: (state: CaptureState) => void,
  prepareCamera: typeof preparePoseGuardCamera,
) {
  signal.throwIfAborted();
  update({ ...INITIAL_CAPTURE_STATE, title: "Preparing your enrollment", hint: "" });
  const wallet = await logPoseGuardStep("wallet_ready", async () => {
    const state = await abortable(session.ready, signal);
    if ("error" in state) throw state.error;
    return state.wallet;
  });
  const { sub, blindingFactor } = await logPoseGuardStep("prepare_credential", () =>
    prepareEnrollmentCredential(wallet, signal, update));
  const custody = await abortable(crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]), signal);
  if (!("publicKey" in custody)) throw new Error("Could not prepare a custody key pair.");
  const publicKey = new Uint8Array(await abortable(crypto.subtle.exportKey("raw", custody.publicKey), signal));

  // Bound permission and model startup separately from the enclave's capture window.
  update(INITIAL_CAPTURE_STATE);
  const start = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  const cameraScope = new AbortController();
  const camera = await abortable(prepareCamera(video, AbortSignal.any([signal, cameraScope.signal]), update), start).catch(error => {
    cameraScope.abort(error);
    throw error;
  });
  let images: PoseGuardImages | undefined;
  const enrollmentSignal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  try {
    update({ phase: "checking", title: "Waiting for PoseGuard targets", hint: "Keep your face in the oval.", progress: 0, cameraReady: true });
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
        update(checking("Checking your PoseGuard captures"));
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
    return { capture, identity, wallet, blindingFactor };
  } finally {
    camera.close();
    if (images) clearImages(images);
  }
}

async function prepareEnrollmentCredential(wallet: WalletKit, signal: AbortSignal, update: (state: CaptureState) => void) {
  const prepare = () => {
    signal.throwIfAborted();
    return abortable(wallet.prepareCredential(11n), signal);
  };
  try {
    return await prepare();
  } catch (error) {
    if (!isIndexerLeafOutOfRange(error)) throw error;
  }
  // An indexed account can appear in the database before the tree has its leaf.
  update({ ...INITIAL_CAPTURE_STATE, title: "Waiting for your World ID to sync", hint: "" });
  return logPoseGuardStep("indexer_retry", async () => {
    await pause(1_000, signal);
    try {
      return await prepare();
    } catch (error) {
      if (!isIndexerLeafOutOfRange(error)) throw error;
      throw new WalletOpenError("The staging indexer could not find your account in its proof tree yet. Try again in a moment.", { cause: error });
    }
  });
}

function isIndexerLeafOutOfRange(error: unknown): boolean {
  const prefix = "network_error at indexer: ";
  if (!(error instanceof Error) || error.name !== "WalletKitError" ||
    !("code" in error) || error.code !== "NetworkError" || !error.message.startsWith(prefix)) return false;
  const body = error.message.slice(prefix.length).split(" (NetworkError {", 1)[0];
  return /"code"\s*:\s*"invalid_leaf_index"/.test(body) &&
    /"message"\s*:\s*"Leaf index out of range\."/.test(body);
}

function teeRejection(result: SelfieCaptureFailure): Error {
  if (result.reason === "challenge") {
    const step = result.index + 2;
    logPoseGuardEvent("poseguard_rejected", { step, reason: result.challengeReason });
    return new Error(`The staging TEE rejected the capture at step ${step}. Try again.`);
  }
  logPoseGuardEvent("poseguard_rejected", { reason: result.reason });
  if (result.reason === "quality_rejected") {
    return new Error("The center frame did not pass the staging TEE’s quality check. Try again with your face evenly lit and fully in view.");
  }
  return new Error("The staging TEE could not accept these PoseGuard captures. Try again.");
}

function clearImages(images: PoseGuardImages) {
  images.centralPng.fill(0);
  for (const image of images.captures) image.fill(0);
}

function checking(title: string): CaptureState {
  return { phase: "checking", title, hint: "", progress: 1, cameraReady: false };
}
