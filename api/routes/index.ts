import type { RouteTable } from "../lib/http";
import type { SelfieEnrollmentPolicy } from "../lib/selfie-enrollment";
import { GET as consentGet, PUT as consentPut } from "./api/consent";
import { GET as healthLive } from "./api/health/live";
import { ready as healthReady } from "./api/health/ready";
import { GET as selfieEnrollment } from "./api/selfie-enrollment";
import { GET as stagingRp } from "./api/staging-rp";
import { page as recoverPage } from "./recover";
import { GET as root } from "./root";
import { page as verifyPage } from "./verify";
import { POST as issueSelfie } from "./api/selfie-credential";

// Every server route. Folder paths match the URL. Anything unmatched falls
// through to the static web app, except /api/* which must never return the SPA.
export function createRoutes({ staticRoot, selfieEnrollmentPolicy, localStagingIssuance }: { staticRoot: string; selfieEnrollmentPolicy?: SelfieEnrollmentPolicy; localStagingIssuance?: boolean }): RouteTable {
  return {
    "/api/health/live": { GET: healthLive },
    "/api/health/ready": { GET: healthReady(staticRoot) },
    "/api/consent": { GET: consentGet, PUT: consentPut },
    "/api/selfie-enrollment": { GET: selfieEnrollment(selfieEnrollmentPolicy) },
    "/api/staging-rp": { GET: stagingRp },
    ...(localStagingIssuance ? { "/api/selfie-credential": { GET: () => Response.json({ enabled: true }), POST: issueSelfie } } : {}),
    "/api/*": () => Response.json({ error: "Not found" }, { status: 404 }),
    "/": { GET: root },
    "/verify": { GET: verifyPage(staticRoot) },
    "/recover": { GET: recoverPage(staticRoot) },
  };
}
