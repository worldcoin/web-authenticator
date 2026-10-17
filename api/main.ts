import { AUTHENTICATOR_APP_CONFIG } from "./lib/config";
import { createServerOptions } from "./server";

Bun.serve({
  hostname: AUTHENTICATOR_APP_CONFIG.host,
  port: AUTHENTICATOR_APP_CONFIG.port,
  maxRequestBodySize: 1024,
  idleTimeout: 180,
  ...createServerOptions(),
});
