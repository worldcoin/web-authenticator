import type { RouteTable } from "../lib/http";
import { GET as healthLive } from "./api/health/live";
import { ready as healthReady } from "./api/health/ready";
import { GET as stagingRp } from "./api/staging-rp";

// Every API route. Folder paths match the URL. Anything unmatched falls through to the
// static web app, which serves index.html for client routes (see lib/client-routes.ts),
// except /api/* which must never return the SPA.
export function createRoutes({ staticRoot }: { staticRoot: string }): RouteTable {
  return {
    "/api/health/live": { GET: healthLive },
    "/api/health/ready": { GET: healthReady(staticRoot) },
    "/api/staging-rp": { GET: stagingRp },
    "/api/*": () => Response.json({ error: "Not found" }, { status: 404 }),
  };
}
