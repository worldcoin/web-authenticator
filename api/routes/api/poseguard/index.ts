import { POSEGUARD_BODY_LIMIT, isPoseGuardCapability, isPoseGuardEvidence } from "../../../../packages/contracts/src/poseguard";
import { authorizePoseGuard, PoseGuardError, PoseGuardRuns } from "../../../lib/poseguard";
import { readJsonBody, RequestBodyError } from "../../../lib/request-body";

export function createPoseGuardHandlers(runs = new PoseGuardRuns(), authorize = authorizePoseGuard) {
  let active = 0;
  const handler = (kind: "challenge" | "verify" | "cancel") => async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const site = request.headers.get("sec-fetch-site");
    if (request.headers.get("origin") !== new URL(request.url).origin || (site !== null && site !== "same-origin") ||
      request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return reply({ error: "same_origin_required" }, 403);
    if (active >= 4) return reply({ error: "challenge_capacity" }, 429);
    active++;
    try {
      const body = await readJsonBody(request, kind === "verify" ? POSEGUARD_BODY_LIMIT : kind === "challenge" ? 131_072 : 1024);
      if (kind === "challenge") {
        let authorization;
        try { authorization = await authorize(body); }
        catch { return reply({ error: "invalid_request" }, 403); }
        return reply(runs.create(authorization.binding, authorization.expiresAt), 201);
      }
      if (!isPoseGuardCapability(body) || Object.keys(body).sort().join(",") !== (kind === "verify" ? "capability,evidence,id" : "capability,id")) return reply({ error: "invalid_request" }, 400);
      if (kind === "cancel") { runs.cancel(body.id, body.capability); return new Response(null, { status: 204 }); }
      const evidence = (body as typeof body & { evidence: unknown }).evidence;
      if (!isPoseGuardEvidence(evidence)) return reply({ error: "invalid_evidence" }, 400);
      return reply(runs.verify(body.id, body.capability, evidence));
    } catch (error) {
      if (error instanceof RequestBodyError) return reply({ error: "invalid_request" }, error.status);
      if (error instanceof PoseGuardError) return reply({ error: error.code }, error.status);
      // Never log evidence, request capabilities or upstream errors.
      return reply({ error: "challenge_unavailable" }, 503);
    } finally { active--; }
  };
  return { challenge: handler("challenge"), verify: handler("verify"), cancel: handler("cancel") };
}
