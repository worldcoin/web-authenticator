import { DEMO_REQUEST_PATH } from "../../config/demo";
import type { ProtocolEnvironment } from "../../config/environment";
import { handleDemoApi } from "../lib/demo";
import type { RouteTable } from "../lib/http";
import { GET as healthLive } from "./api/health/live";
import { ready as healthReady } from "./api/health/ready";
import { GET as rp } from "./api/rp";
import { GET as requesterName } from "./api/requester-name";
import { GET as stagingRp } from "./api/staging-rp";

// Unmatched API paths must never fall through to the static app's client-side router.
export function createRoutes({ staticRoot, environment }: { staticRoot: string; environment: ProtocolEnvironment }): RouteTable {
  return {
    "/api/health/live": { GET: healthLive },
    "/api/health/ready": { GET: healthReady(staticRoot) },
    "/api/staging-rp": { GET: stagingRp },
    "/api/rp": { GET: request => rp(request, environment) },
    ...(environment === "production" && { "/api/requester-name": { GET: requesterName } }),
    ...(environment === "staging" && { [DEMO_REQUEST_PATH]: { POST: localDemoRequest } }),
    "/api/*": () => Response.json({ error: "Not found" }, { status: 404 }),
  };
}

function localDemoRequest(request: Request): Promise<Response> | Response {
  if (new URL(request.url).protocol !== "http:") return Response.json({ error: "Not found" }, { status: 404 });
  return handleDemoApi(request, "staging", process.env);
}
