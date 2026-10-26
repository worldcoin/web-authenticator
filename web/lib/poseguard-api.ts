import { POSEGUARD_BODY_LIMIT, POSEGUARD_PROFILE, isPoseGuardCapability, type PoseGuardChallenge, type PoseGuardEvidence, type PoseGuardVerdict } from '../../packages/contracts/src/poseguard';
import type { Payload } from './proof-request';
import { withAbort, type CaptureResult } from './selfie-capture';
import { capturePoseGuard, type PoseCaptureState } from './poseguard-capture';

const unavailable = () => new Error('The movement check could not be verified. Please try again.');
async function post(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const json = JSON.stringify(body);
  if (new TextEncoder().encode(json).byteLength > POSEGUARD_BODY_LIMIT) throw unavailable();
  const response = await fetch(`/api/poseguard/${path}`, {
    method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: json, signal,
  });
  if (!response.ok) throw unavailable();
  return response.json();
}
export async function createPoseGuardChallenge(payload: Payload): Promise<PoseGuardChallenge> {
  const value = await post('challenge', payload, AbortSignal.timeout(15_000));
  if (!isPoseGuardCapability(value)) throw unavailable();
  const challenge = value as PoseGuardChallenge;
  if (challenge.profile !== POSEGUARD_PROFILE || typeof challenge.seed !== 'string' || !/^-?\d{1,20}$/.test(challenge.seed) ||
    BigInt(challenge.seed) < -(2n ** 63n) || BigInt(challenge.seed) >= 2n ** 63n || !Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= Date.now()) throw unavailable();
  return challenge;
}
export async function verifyPoseGuardChallenge(challenge: PoseGuardChallenge, evidence: PoseGuardEvidence, signal: AbortSignal): Promise<PoseGuardVerdict> {
  const value = await post('verify', { id: challenge.id, capability: challenge.capability, evidence }, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
  const verdict = value as PoseGuardVerdict | null;
  if (!verdict || verdict.profile !== POSEGUARD_PROFILE || !['passed', 'failed', 'inconclusive'].includes(verdict.status) ||
    typeof verdict.outcome !== 'string' || typeof verdict.reason !== 'string') throw unavailable();
  return verdict;
}
export async function cancelPoseGuardChallenge(challenge: PoseGuardChallenge) {
  try {
    await fetch('/api/poseguard/cancel', { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: challenge.id, capability: challenge.capability }),
      keepalive: true, signal: AbortSignal.timeout(5_000) });
  } catch { /* Best effort: server TTL also releases abandoned runs. */ }
}

/** The UI advances only after both the local guide and the API agree. Never authorizes issuance. */
export async function captureVerifiedPoseGuard(video: HTMLVideoElement, signal: AbortSignal, update: (state: PoseCaptureState) => void,
  payload: Payload | undefined, options: { retainPreviewUntilAbort?: boolean } = {}): Promise<CaptureResult> {
  if (!payload) throw new Error('Return to the requesting app to start a new check.');
  signal.throwIfAborted();
  let challenge: PoseGuardChallenge | undefined;
  let consumed = false, succeeded = false;
  const own = new AbortController();
  const attempt = AbortSignal.any([signal, own.signal]);
  try {
    update({ phase: 'starting', title: 'Preparing your check', hint: 'Getting the movements ready.', progress: 0, cameraReady: false });
    // Let an in-flight creation finish so a late response can be cancelled after the tab leaves.
    const pending = createPoseGuardChallenge(payload).then(value => {
      if (attempt.aborted) { void cancelPoseGuardChallenge(value); attempt.throwIfAborted(); }
      return value;
    });
    challenge = await withAbort(pending, attempt);
    const result = await capturePoseGuard(video, attempt, update, challenge, options);
    attempt.throwIfAborted();
    update({ phase: 'capturing', title: 'Checking your movements', hint: 'Just a moment.', progress: 1, cameraReady: options.retainPreviewUntilAbort === true });
    const verdict = await withAbort(verifyPoseGuardChallenge(challenge, result.evidence, attempt), attempt);
    consumed = true;
    attempt.throwIfAborted();
    if (verdict.status !== 'passed' || result.verdict.status !== 'passed') throw new Error(verdict.status === 'passed' ? result.verdict.reason : verdict.reason);
    succeeded = true;
    return { image: result.image, timing: result.timing };
  } finally {
    if (!succeeded) own.abort();
    if (challenge && !consumed) await cancelPoseGuardChallenge(challenge);
  }
}
