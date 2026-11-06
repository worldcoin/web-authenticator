import { abortable } from "./async";
import { ENROLLMENT_CONTEXT, parseEnrollmentChallenge, validateEnrollmentCapture, type EnrollmentCapture } from "./enrollment-contract";
import { submitEnrollment, type SignupServiceOptions } from "./signup-service";
import type { WalletKit } from "./walletkit";

/** Caller retains the PCP before submitting. Aborting a running proof terminates the wallet worker. */
export async function submitEnrollmentWithProof(
  wallet: Pick<WalletKit, "proveCredentialSub" | "terminate">,
  capture: EnrollmentCapture,
  challengeValue: unknown,
  blindingFactor: string,
  options: SignupServiceOptions,
) {
  options.signal.throwIfAborted();
  const { sub } = validateEnrollmentCapture(capture);
  const challenge = parseEnrollmentChallenge(challengeValue);
  const snapshot: EnrollmentCapture = {
    fields: capture.fields.map(({ name, value }) => ({ name, value })),
    attestation_header: capture.attestation_header,
  };
  const remaining = Math.min(120_000, Date.parse(challenge.expires_at) - Date.now());
  if (remaining <= 0) throw new Error("Enrollment ownership challenge expired; obtain a fresh challenge");
  const proving = AbortSignal.any([options.signal, AbortSignal.timeout(remaining)]);
  const stop = () => wallet.terminate();
  proving.addEventListener("abort", stop, { once: true });
  let proofCbor: Uint8Array;
  try {
    proving.throwIfAborted();
    proofCbor = await abortable(wallet.proveCredentialSub(challenge.nonce, ENROLLMENT_CONTEXT, blindingFactor, sub), proving);
  } finally {
    proving.removeEventListener("abort", stop);
  }
  options.signal.throwIfAborted();
  parseEnrollmentChallenge(challenge);
  return submitEnrollment(snapshot, { challengeId: challenge.challenge_id, proofCbor }, options);
}
