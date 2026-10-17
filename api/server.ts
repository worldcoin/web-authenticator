import { resolve } from "node:path";
import { internalError, secureRoutes, withSecurityHeaders } from "./lib/http";
import { DEFAULT_STATIC_ROOT, serveStatic } from "./lib/static";
import { createRoutes } from "./routes";

export function createServerOptions(options: { staticRoot?: string } = {}) {
  const staticRoot = resolve(options.staticRoot ?? DEFAULT_STATIC_ROOT);
  return {
    routes: secureRoutes(createRoutes({ staticRoot })),
    fetch: withSecurityHeaders(request => serveStatic(request, staticRoot)),
    error: internalError,
  };
}
