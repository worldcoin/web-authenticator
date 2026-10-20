import type { RouteTable } from "../lib/http";
import { GET as consentGet, PUT as consentPut } from "./api/consent";
import { GET as healthLive } from "./api/health/live";
import { ready as healthReady } from "./api/health/ready";
import { GET as stagingRp } from "./api/staging-rp";
import { page as verifyPage } from "./verify";
import { POST as fauxCredential } from "./api/faux-credential";
import { POST as selfieCredential } from "./api/selfie-credential";

// Every server route. Folder paths match the URL. Anything unmatched falls
// through to the static web app, except /api/* which must never return the SPA.
export function createRoutes({ staticRoot, stagingIssuers = false }: { staticRoot: string; stagingIssuers?: boolean }): RouteTable {
  return {
    "/api/health/live": { GET: healthLive },
    "/api/health/ready": { GET: healthReady(staticRoot) },
    "/api/consent": { GET: consentGet, PUT: consentPut },
    "/api/staging-rp": { GET: stagingRp },
    ...(stagingIssuers ? { "/api/faux-credential": { POST: fauxCredential }, "/api/selfie-credential": { POST: selfieCredential } } : {}),
    "/api/*": () => Response.json({ error: "Not found" }, { status: 404 }),
    "/verify": { GET: verifyPage(staticRoot) },
  };
}
