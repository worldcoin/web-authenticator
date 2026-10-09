import { AUTHENTICATOR_APP_CONFIG } from "../../../../config/authenticator-app-v0";
import { createAuthenticatorHttpHandler } from "./http.server";

Bun.serve({
  hostname: AUTHENTICATOR_APP_CONFIG.host,
  port: AUTHENTICATOR_APP_CONFIG.port,
  maxRequestBodySize: 1024,
  idleTimeout: 180,
  fetch: createAuthenticatorHttpHandler(),
});
