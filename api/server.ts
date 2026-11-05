import { resolve } from "node:path";
import type { ProtocolEnvironment } from "../config/environment";
import { AUTHENTICATOR_APP_CONFIG } from "./lib/config";
import { internalError, secureRoutes, withSecurityHeaders } from "./lib/http";
import { DEFAULT_STATIC_ROOT, serveStatic } from "./lib/static";
import { createRoutes } from "./routes";

export function createServerOptions(options: { staticRoot?: string; environment?: ProtocolEnvironment } = {}) {
  const staticRoot = resolve(options.staticRoot ?? DEFAULT_STATIC_ROOT);
  const environment = options.environment ?? AUTHENTICATOR_APP_CONFIG.environment;
  return {
    routes: secureRoutes(createRoutes({ staticRoot }), environment),
    fetch: withSecurityHeaders(request => serveStatic(request, staticRoot), environment),
    error: (error: Error) => internalError(error, environment),
  };
}
