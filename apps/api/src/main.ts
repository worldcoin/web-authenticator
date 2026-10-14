import { AUTHENTICATOR_APP_CONFIG } from "./config";
import { createAuthenticatorHttpHandler } from "./http";

Bun.serve({
  hostname: AUTHENTICATOR_APP_CONFIG.host,
  port: AUTHENTICATOR_APP_CONFIG.port,
  maxRequestBodySize: 1024,
  idleTimeout: 180,
  fetch: createAuthenticatorHttpHandler(),
});
