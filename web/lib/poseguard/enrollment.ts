import { ENVIRONMENTS, parsePoseGuardTestMode, type SelfieEnrollmentPolicy } from "../../../config/environment";
import { abortable } from "../async";
import { currentProtocolEnvironment } from "../environment";
import { ENROLLMENT_CONTEXT, EnrollmentCaptureSchema, isCanonicalSubject, parseEnrollmentChallenge, validateEnrollmentCapture } from "../enrollment-contract";
import { fetchEnrollmentChallenge } from "../enrollment-challenge";
import { type CaptureState } from "../selfie-capture";
import {
  getEnrollmentAuthorization, pollEnrollment, SignupServiceError, submitEnrollment,
  type EnrollmentAuthorization, type EnrollmentReceipt, type EnrollmentResult,
} from "../signup-service";
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
    return { policy, endpoint, testMode: true };
  }

  const path = policy.authorizationPath;
  if (!path) return;
  return {
    policy, endpoint, testMode: false,
    authorize: (identity, signal) => getEnrollmentAuthorization(path, identity, signal),
  };
}

export function configureDemoEnrollment(session: RequestWalletSession, signal: AbortSignal): RunPoseGuard | undefined {
  const { appOrigin, selfieEnrollment: policy, signupServiceOrigin } = ENVIRONMENTS.staging;
  const challengeUrl = policy?.ownershipChallengeUrl;
  if (currentProtocolEnvironment() !== "staging" || window.location.origin !== appOrigin || !policy || !challengeUrl) return;

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
        const state = await abortable(session.ready, signal);
        if ("error" in state) throw state.error;
        const wallet = state.wallet;
        const { sub, blindingFactor } = await abortable(wallet.prepareCredential(11n), signal);
        if (!isCanonicalSubject(sub)) throw new Error("WalletKit returned an invalid enrollment subject.");
        const custody = await abortable(crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]), signal);
        if (!("publicKey" in custody)) throw new Error("Could not prepare a custody key pair.");
        const publicKey = new Uint8Array(await abortable(crypto.subtle.exportKey("raw", custody.publicKey), signal));
        const configured = signup.policy;
        const start = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
        // The startup deadline bounds permission/model load. A separate capture deadline begins with the prompt.
        const cameraScope = new AbortController();
        const camera = await abortable(prepareCamera(video, AbortSignal.any([signal, cameraScope.signal]), update), start).catch(error => {
          cameraScope.abort(error);
          throw error;
        });
        let images: PoseGuardImages | undefined;
        const enrollmentSignal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
        try {
          const result = await abortable(wallet.enrollSelfieWithPoseGuard(
            JSON.stringify({ endpoint: configured.endpoint, releases: configured.releases }),
            sub, publicKey, async (prompt, callbackSignal) => {
              const captureSignal = AbortSignal.any([enrollmentSignal, camera.signal, callbackSignal]);
              images = await collectPoseGuardImages(prompt, captureSignal, camera.readFrame, update);
              update(checking("Checking your selfie"));
              camera.close();
              return images;
            }, enrollmentSignal,
          ), enrollmentSignal);
          if (result.status !== "success") throw new Error("PoseGuard could not accept these captures. Try again.");
          const bundle = result.enrollment;
          try {
            enrollmentSignal.throwIfAborted();
            const capture = EnrollmentCaptureSchema.parse({
              fields: bundle.fields,
              attestation_header: signup.testMode ? TEST_ATTESTATION_HEADER : bundle.attestationHeader,
            });
            const identity = validateEnrollmentCapture(capture);
            if (identity.sub !== sub) throw new Error("The selfie enrollment does not match this wallet.");
            update(checking("Submitting your selfie check"));
            const authorization = signup.testMode
              ? { challengeId: TEST_CHALLENGE_ID, proofCbor: Uint8Array.of(0xa0) }
              : await abortable(signup.authorize(identity, signal, wallet, blindingFactor), signal);
            try {
              signal.throwIfAborted();
              // Keep the capture ID even if the server accepted the PUT and the response was lost.
              receipt = identity;
              if (!signup.testMode && signup.saveCredential) owner = { wallet, factor: blindingFactor };
              receipt = await submitEnrollment(capture, authorization, signupOptions);
            } catch (error) {
              if (!signal.aborted && (error instanceof TypeError ||
                (error instanceof SignupServiceError && error.status !== undefined &&
                  error.status >= 400 && error.status < 500 && error.status !== 408))) receipt = undefined;
              throw error;
            } finally {
              authorization.proofCbor.fill(0);
            }
          } finally {
            // The signed credential is saved separately from the encrypted custody package.
            bundle.encryptedCustody.fill(0);
          }
        } finally {
          camera.close();
          if (images) {
            images.centralPng.fill(0);
            for (const image of images.captures) image.fill(0);
          }
        }
      }

      update(checking("Waiting for enrollment status"));
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

function checking(title: string): CaptureState {
  return { phase: "checking", title, hint: "", progress: 1, cameraReady: false };
}
