import { ENVIRONMENTS } from "../../config/environment";
import { currentProtocolEnvironment } from "./environment";
import { createPoseGuardCapture, createPoseGuardEnrollment, ownershipChallengeAuthorization, type RunPoseGuard } from "./poseguard/enrollment";
import { WalletOpenError } from "./wallet-errors";
import type { RequestWalletSession } from "./wallet-session";

/** Picks the demo's PoseGuard flow: capture only on localhost, otherwise submit to staging signup-service. */
export function configureDemoEnrollment(session: RequestWalletSession, signal: AbortSignal): RunPoseGuard {
  const { appOrigin, selfieEnrollment: policy, signupServiceOrigin } = ENVIRONMENTS.staging;
  if (currentProtocolEnvironment() !== "staging" || !policy) {
    throw new WalletOpenError("PoseGuard requires a configured staging TEE release.");
  }
  if (window.location.protocol === "http:") return createPoseGuardCapture(session, policy, signal);
  if (window.location.origin !== appOrigin) {
    throw new WalletOpenError("Open the demo at the staging authenticator origin to issue a credential.");
  }
  const endpoint = new URL("/api/v2/identity", signupServiceOrigin).href;
  const challengeUrl = policy.ownershipChallengeUrl;
  // The staging v2 route accepts the TEE bundle on its own.
  if (!challengeUrl) return createPoseGuardEnrollment(session, { mode: "staging", policy, endpoint }, signal);
  return createPoseGuardEnrollment(session, {
    mode: "production", saveCredential: true, policy, endpoint, authorize: ownershipChallengeAuthorization(challengeUrl),
  }, signal);
}
