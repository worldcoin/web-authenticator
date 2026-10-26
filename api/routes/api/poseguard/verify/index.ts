import { POSEGUARD_BODY_LIMIT, isPoseGuardCapability, isPoseGuardEvidence } from "../../../../../packages/contracts/src/poseguard";
import type { PoseGuardContext } from "../../../../lib/poseguard-http";

export function verify({ runs, reply, handle }: PoseGuardContext) {
  return handle(POSEGUARD_BODY_LIMIT, body => {
    if (!isPoseGuardCapability(body) || Object.keys(body).sort().join(",") !== "capability,evidence,id") return reply({ error: "invalid_request" }, 400);
    const evidence = (body as typeof body & { evidence: unknown }).evidence;
    if (!isPoseGuardEvidence(evidence)) return reply({ error: "invalid_evidence" }, 400);
    return reply(runs.verify(body.id, body.capability, evidence));
  });
}
