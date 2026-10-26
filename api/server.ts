import { resolve } from "node:path";
import { SELFIE_ENROLLMENT_POLICY } from "./lib/config";
import { internalError, secureRoutes, withSecurityHeaders } from "./lib/http";
import type { SelfieEnrollmentPolicy } from "./lib/selfie-enrollment";
import { DEFAULT_STATIC_ROOT, serveStatic } from "./lib/static";
import { createRoutes } from "./routes";

export function createServerOptions(options: { staticRoot?: string; selfieEnrollmentPolicy?: SelfieEnrollmentPolicy } = {}) {
  const staticRoot = resolve(options.staticRoot ?? DEFAULT_STATIC_ROOT);
  const selfieEnrollmentPolicy = options.selfieEnrollmentPolicy ?? SELFIE_ENROLLMENT_POLICY;
  return {
    routes: secureRoutes(createRoutes({ staticRoot, selfieEnrollmentPolicy })),
    fetch: withSecurityHeaders(request => serveStatic(request, staticRoot)),
    error: internalError,
  };
}
