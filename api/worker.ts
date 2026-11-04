import { createAccessVerifier } from "./lib/cloudflare-access";
import { serveWorkerAsset } from "./lib/cloudflare-assets";
import { internalError, withSecurityHeaders } from "./lib/http";
import { GET as healthLive } from "./routes/api/health/live";
import { lookupRp } from "./lib/rp-handler";
import { APP_ORIGINS, type ProtocolEnvironment } from "../config/environment";

const verifyAccess = createAccessVerifier();

export function createWorkerHandler(authenticate = verifyAccess) {
  return (request: Request, env: Env) => {
    const environment = env.APP_ENV === "staging" || env.APP_ENV === "production" ? env.APP_ENV : undefined;
    return withSecurityHeaders(request => handle(request, env, environment, authenticate), environment)(request);
  };
}

async function handle(request: Request, env: Env, configured: ProtocolEnvironment | undefined, authenticate: typeof verifyAccess): Promise<Response> {
  try {
    if (configured === undefined) return Response.json({ error: "Invalid deployment configuration" }, { status: 503 });
    const environment = configured;
    const origin = APP_ORIGINS[environment];
    if (environment === "staging") {
      const denied = await authenticate(request, env);
      if (denied) return denied;
    } else if (new URL(request.url).origin !== origin) {
      return Response.json({ error: "Unsupported authenticator origin" }, { status: 421 });
    }
    const pathname = new URL(request.url).pathname;
    const method = request.method === "HEAD" ? "GET" : request.method;
    let response: Response;
    if (pathname === "/api/health/live" && method === "GET") response = healthLive();
    else if (pathname === "/api/health/ready" && method === "GET") {
      const index = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
      const available = index.status === 200;
      await index.body?.cancel();
      response = available ? Response.json({ status: "ready", environment, protocol: environment,
        origin, commit: env.CF_VERSION_METADATA?.tag ?? null })
        : Response.json({ status: "unavailable", failed: ["web_bundle"] }, { status: 503 });
    } else if ((pathname === "/api/rp" || (pathname === "/api/staging-rp" && environment === "staging")) && method === "GET") {
      response = await lookupRp(request, environment);
    }
    else if (pathname === "/api" || pathname.startsWith("/api/")) response = Response.json({ error: "Not found" }, { status: 404 });
    else response = await serveWorkerAsset(request, env.ASSETS);
    if (request.method === "HEAD") {
      await response.body?.cancel();
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  } catch (error) {
    return internalError(error instanceof Error ? error : new Error("Worker request failed"), configured);
  }
}

export default { fetch: createWorkerHandler() } satisfies ExportedHandler<Env>;
