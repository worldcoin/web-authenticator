import type { RouteTable } from "../lib/http";
import * as health from "./health";
import * as stagingRp from "./staging-rp";
import * as verify from "./verify";

// Every server route. Anything unmatched falls through to the static web app,
// except /api/* which must never return the SPA.
export function createRoutes({ staticRoot }: { staticRoot: string }): RouteTable {
  return {
    "/api/health/live": { GET: health.live },
    "/api/health/ready": { GET: health.ready(staticRoot) },
    "/api/staging-rp": { GET: stagingRp.GET },
    "/api/*": () => Response.json({ error: "Not found" }, { status: 404 }),
    "/verify": { GET: verify.GET },
  };
}
