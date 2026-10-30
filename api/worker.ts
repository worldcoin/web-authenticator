import { createAccessVerifier } from "./lib/cloudflare-access";
import { serveWorkerAsset } from "./lib/cloudflare-assets";
import { internalError, withSecurityHeaders } from "./lib/http";
import { GET as healthLive } from "./routes/api/health/live";
import { GET as stagingRp } from "./routes/api/staging-rp";

const verifyAccess = createAccessVerifier();

export function createWorkerHandler(authenticate = verifyAccess) {
  return (request: Request, env: Env) => withSecurityHeaders(async request => {
    try {
      const denied = await authenticate(request, env);
      if (denied) return denied;
      const pathname = new URL(request.url).pathname;
      const method = request.method === "HEAD" ? "GET" : request.method;
      let response: Response;
      if (pathname === "/api/health/live" && method === "GET") response = healthLive();
      else if (pathname === "/api/health/ready" && method === "GET") {
        const index = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
        const available = index.status === 200;
        await index.body?.cancel();
        response = available ? Response.json({ status: "ready" })
          : Response.json({ status: "unavailable", failed: ["web_bundle"] }, { status: 503 });
      } else if (pathname === "/api/staging-rp" && method === "GET") response = await stagingRp(request);
      else if (pathname === "/api" || pathname.startsWith("/api/")) response = Response.json({ error: "Not found" }, { status: 404 });
      else response = await serveWorkerAsset(request, env.ASSETS);
      if (request.method === "HEAD") {
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    } catch (error) {
      return internalError(error instanceof Error ? error : new Error("Worker request failed"));
    }
  })(request);
}

export default { fetch: createWorkerHandler() } satisfies ExportedHandler<Env>;
