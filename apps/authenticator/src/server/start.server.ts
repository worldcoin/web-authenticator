import { AUTHENTICATOR_APP_CONFIG } from "@clean-start/app-config";
import { createAuthenticatorHttpHandlerV0 } from "./http.server";
import { createAuthenticatorServerRuntimeV0 } from "./runtime.server";

export async function startAuthenticatorServerV0(): Promise<ReturnType<typeof Bun.serve>> {
  const runtime = await createAuthenticatorServerRuntimeV0();
  const handler = createAuthenticatorHttpHandlerV0(runtime.browserPort);
  return Bun.serve({
    hostname: AUTHENTICATOR_APP_CONFIG.host,
    port: AUTHENTICATOR_APP_CONFIG.port,
    fetch: handler,
  });
}
