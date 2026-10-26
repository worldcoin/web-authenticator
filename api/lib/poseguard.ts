import { createHash, randomBytes } from "node:crypto";
import { Session, targets } from "../../packages/poseguard/src/vendor/posechallenge.js";
import { decodeObservation } from "../../packages/poseguard/src/evidence";
import { POSEGUARD_PROFILE, POSEGUARD_TTL_MS, type PoseGuardChallenge, type PoseGuardEvidence, type PoseGuardVerdict } from "../../packages/contracts/src/poseguard";
import { parsePayload, verifyRequestSignature } from "../../packages/contracts/src/proof-request";
import { readStagingRp } from "./rp-registry";

export class PoseGuardError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export async function authorizePoseGuard(value: unknown, lookup: typeof readStagingRp = readStagingRp): Promise<{ binding: string; expiresAt: number }> {
  const payload = parsePayload(JSON.stringify(value));
  const proof = payload.proof_request;
  if (payload.require_user_presence || payload.identity_attributes?.length || proof.proof_requests.some(item => item.issuer_schema_id !== 11)) {
    throw new PoseGuardError(400, "unsupported_request");
  }
  const rp = await lookup(BigInt("0x" + proof.rp_id.slice(3)));
  if (!rp.initialized || !rp.active) throw new PoseGuardError(403, "invalid_request");
  await verifyRequestSignature(proof, { signer: rp.signer, oprfKeyId: `0x${rp.oprfKeyId.toString(16)}` });
  // No payload, RP identity or signature is retained in the run store.
  const binding = createHash("sha256").update([BigInt("0x" + proof.rp_id.slice(3)).toString(), proof.nonce.toLowerCase(), proof.action.toLowerCase(), proof.created_at, proof.expires_at].join(":")).digest("hex");
  return { binding, expiresAt: proof.expires_at * 1000 };
}

type Run = { challenge: PoseGuardChallenge; binding: string; deadline: number; created: number };
/** Single-process beta store. A shared atomic store is required before a multi-instance deployment. */
export class PoseGuardRuns {
  private runs = new Map<string, Run>();
  constructor(private readonly now = () => performance.now(), private readonly wallTime = () => Date.now()) {}
  private prune() {
    for (const [id, run] of this.runs) if (run.deadline <= this.now() || run.challenge.expiresAt <= this.wallTime()) this.runs.delete(id);
  }
  create(binding: string, requestExpiresAt: number): PoseGuardChallenge {
    this.prune();
    if (requestExpiresAt <= this.wallTime()) throw new PoseGuardError(410, "request_expired");
    for (const run of this.runs.values()) if (run.binding === binding) throw new PoseGuardError(409, "challenge_in_progress");
    if (this.runs.size >= 64) throw new PoseGuardError(429, "challenge_capacity");
    const seed = randomBytes(8).readBigInt64BE().toString();
    const ttl = Math.min(POSEGUARD_TTL_MS, requestExpiresAt - this.wallTime());
    const challenge: PoseGuardChallenge = { id: crypto.randomUUID(), capability: randomBytes(32).toString("hex"),
      profile: POSEGUARD_PROFILE, seed, expiresAt: this.wallTime() + ttl,
      targets: targets(seed).map(target => ({ directionDegrees: target.direction, armDelaySeconds: target.armDelay })) };
    const created = this.now();
    this.runs.set(challenge.id, { challenge, binding, created, deadline: created + ttl });
    return structuredClone(challenge);
  }
  private claim(id: string, capability: string): Run {
    this.prune();
    const run = this.runs.get(id);
    if (!run || run.challenge.capability !== capability) throw new PoseGuardError(410, "challenge_unavailable");
    // Atomic before evaluation, including rejected evidence. A new attempt needs a new challenge.
    this.runs.delete(id);
    return run;
  }
  cancel(id: string, capability: string) { this.claim(id, capability); }
  verify(id: string, capability: string, evidence: PoseGuardEvidence): PoseGuardVerdict {
    const run = this.claim(id, capability);
    const duration = evidence.frames.at(-1)!.t * 1000;
    if (duration > this.now() - run.created + 250) throw new PoseGuardError(400, "invalid_evidence_timing");
    const first = decodeObservation(evidence.frames[0]);
    const session = new Session(run.challenge.seed, 0, first.yaw, first.pitch, first.landmarks, first.width, first.height);
    for (const frame of evidence.frames.slice(1)) {
      // Fresh-face gaps must fail even when the client omitted its clock ticks.
      session.tick(frame.t);
      if (session.done()) break;
      session.observe(decodeObservation(frame));
    }
    const result = session.result();
    // No browser verdict, target definition, image, embedding or identity claim is accepted.
    return { profile: POSEGUARD_PROFILE, status: result.status, outcome: result.outcome, reason: result.reason };
  }
}
