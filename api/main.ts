import { AUTHENTICATOR_APP_CONFIG } from "./lib/config";
import { createServerOptions } from "./server";

const stagingIssuers = process.env.ENABLE_STAGING_ISSUERS === '1';
if (stagingIssuers && !['127.0.0.1', '::1', 'localhost'].includes(AUTHENTICATOR_APP_CONFIG.host)) {
  throw new Error('Synthetic staging issuers require AUTHENTICATOR_HOST to be loopback.');
}

Bun.serve({
  hostname: AUTHENTICATOR_APP_CONFIG.host,
  port: AUTHENTICATOR_APP_CONFIG.port,
  maxRequestBodySize: 1024,
  idleTimeout: 180,
  ...createServerOptions({ stagingIssuers }),
});
