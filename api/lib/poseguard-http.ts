import { authorizePoseGuard, PoseGuardError, PoseGuardRuns } from "./poseguard";
import { readJsonBody, RequestBodyError } from "./request-body";

export function createPoseGuardContext(runs: PoseGuardRuns, authorize: typeof authorizePoseGuard) {
  let active = 0;
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const handle = (limit: number, action: (body: unknown) => Response | Promise<Response>) => async (request: Request): Promise<Response> => {
    const site = request.headers.get("sec-fetch-site");
    if (request.headers.get("origin") !== new URL(request.url).origin || (site !== null && site !== "same-origin") ||
      request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return reply({ error: "same_origin_required" }, 403);
    if (active >= 4) return reply({ error: "challenge_capacity" }, 429);
    active++;
    try {
      return await action(await readJsonBody(request, limit));
    } catch (error) {
      if (error instanceof RequestBodyError) return reply({ error: "invalid_request" }, error.status);
      if (error instanceof PoseGuardError) return reply({ error: error.code }, error.status);
      // Never log evidence, request capabilities or upstream errors.
      return reply({ error: "challenge_unavailable" }, 503);
    } finally { active--; }
  };
  return { runs, authorize, reply, handle };
}

export type PoseGuardContext = ReturnType<typeof createPoseGuardContext>;
