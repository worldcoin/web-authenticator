import { abortable } from "./async";
import { ENROLLMENT_CONTEXT, parseEnrollmentChallenge, validateEnrollmentCapture, type EnrollmentCapture } from "./enrollment-contract";
import { pollEnrollment, submitEnrollment, type EnrollmentReceipt, type SignupServiceOptions } from "./signup-service";
import type { EnrollmentSession } from "./enrollment-session";
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

/**
 * Runs after verified TEE enrollment. Retention must durably save the PCP, wrapped
 * session keys and blinding factor before submission, then the polling receipt.
 * No WebAuthn calls: optional saving must protect this same session afterwards.
 */
export async function finishEnrollment(
  session: Pick<EnrollmentSession, "wallet" | "sub" | "blindingFactor">,
  capture: EnrollmentCapture,
  challenge: unknown,
  retain: {
    capture(signal: AbortSignal): Promise<void>;
    receipt(receipt: EnrollmentReceipt, signal: AbortSignal): Promise<void>;
  },
  options: SignupServiceOptions,
) {
  options.signal.throwIfAborted();
  if (validateEnrollmentCapture(capture).sub !== session.sub) {
    throw new Error("TEE enrollment subject does not match the prepared session.");
  }
  parseEnrollmentChallenge(challenge);
  const snapshot: EnrollmentCapture = {
    fields: capture.fields.map(({ name, value }) => ({ name, value })),
    attestation_header: capture.attestation_header,
  };
  const retentionSignal = AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]);
  await abortable(retain.capture(retentionSignal), retentionSignal);
  const receipt = await submitEnrollmentWithProof(session.wallet, snapshot, challenge, session.blindingFactor, options);
  const receiptSignal = AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]);
  try {
    await abortable(retain.receipt(receipt, receiptSignal), receiptSignal);
  } catch (cause) {
    throw new Error("Enrollment was accepted, but its polling receipt could not be saved. Keep the retained capture to resume with a fresh ownership proof.", { cause });
  }
  const result = await pollEnrollment(receipt, options);
  if (result.state === "completed") {
    const storing = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]);
    const stop = () => session.wallet.terminate();
    storing.addEventListener("abort", stop, { once: true });
    try {
      storing.throwIfAborted();
      await abortable(session.wallet.storeCredential(result.credential, session.blindingFactor), storing);
    } finally { storing.removeEventListener("abort", stop); }
  }
  return result;
}
