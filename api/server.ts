import { resolve } from "node:path";
import { internalError, secureRoutes, withSecurityHeaders } from "./lib/http";
import { DEFAULT_STATIC_ROOT, serveStatic } from "./lib/static";
import { createRoutes } from "./routes";

export function createServerOptions(options: { staticRoot?: string; stagingIssuers?: boolean } = {}) {
  const staticRoot = resolve(options.staticRoot ?? DEFAULT_STATIC_ROOT);
  return {
    routes: secureRoutes(createRoutes({ staticRoot, stagingIssuers: options.stagingIssuers })),
    fetch: withSecurityHeaders(request => serveStatic(request, staticRoot)),
    error: internalError,
  };
}
