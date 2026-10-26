import { resolve } from "node:path";
import { LOCAL_STAGING_ISSUANCE, SELFIE_ENROLLMENT_POLICY } from "./lib/config";
import { internalError, secureRoutes, withSecurityHeaders } from "./lib/http";
import type { SelfieEnrollmentPolicy } from "./lib/selfie-enrollment";
import { DEFAULT_STATIC_ROOT, serveStatic } from "./lib/static";
import { createRoutes } from "./routes";

export function createServerOptions(options: { staticRoot?: string; selfieEnrollmentPolicy?: SelfieEnrollmentPolicy; localStagingIssuance?: boolean } = {}) {
  const staticRoot = resolve(options.staticRoot ?? DEFAULT_STATIC_ROOT);
  const selfieEnrollmentPolicy = options.selfieEnrollmentPolicy ?? SELFIE_ENROLLMENT_POLICY;
  return {
    routes: secureRoutes(createRoutes({ staticRoot, selfieEnrollmentPolicy, localStagingIssuance: options.localStagingIssuance ?? LOCAL_STAGING_ISSUANCE })),
    fetch: withSecurityHeaders(request => serveStatic(request, staticRoot)),
    error: internalError,
  };
}
