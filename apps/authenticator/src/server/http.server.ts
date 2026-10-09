import { resolve, relative, sep } from "node:path";
import { AUTHENTICATOR_APP_SECURITY_HEADERS_V0, allowsSyntheticIssuance } from "../../../../config/authenticator-app-v0";
import { POST as issueSelfie } from "./selfie-credential.server";
import { GET as lookupRp } from "./staging-rp.server";

const DEFAULT_STATIC_ROOT = resolve(process.cwd(), "apps/authenticator/dist");
const DEFAULT_MEDIAPIPE_ROOT = resolve(
  process.cwd(),
  "node_modules/@mediapipe/tasks-vision/wasm",
);
const MEDIAPIPE_RUNTIME_FILES = new Set([
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]);

function headers(contentType?: string): Headers {
  const result = new Headers(AUTHENTICATOR_APP_SECURITY_HEADERS_V0);
  if (contentType !== undefined) result.set("Content-Type", contentType);
  return result;
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

async function serveMediapipeRuntime(
  pathname: string,
  mediapipeRoot: string,
): Promise<Response> {
  const name = pathname.replace(/^\/mediapipe\//, "");
  if (!MEDIAPIPE_RUNTIME_FILES.has(name)) {
    return new Response("Not found", {
      status: 404,
      headers: headers("text/plain; charset=utf-8"),
    });
  }
  const file = Bun.file(resolve(mediapipeRoot, name));
  if (!(await file.exists())) {
    return new Response("Not found", {
      status: 404,
      headers: headers("text/plain; charset=utf-8"),
    });
  }
  return new Response(file, { headers: headers(contentType(name)) });
}

async function serveStatic(pathname: string, staticRoot: string): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return new Response("Not found", { status: 404, headers: headers("text/plain; charset=utf-8") });
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")) {
    return new Response("Not found", { status: 404, headers: headers("text/plain; charset=utf-8") });
  }
  const assetPath = ["/"].includes(decoded)
    ? "index.html"
    : decoded.replace(/^\//, "");
  const resolved = resolve(staticRoot, assetPath);
  const withinRoot = relative(staticRoot, resolved);
  if (withinRoot.startsWith(`..${sep}`) || withinRoot === ".." || withinRoot.startsWith(sep)) {
    return new Response("Not found", { status: 404, headers: headers("text/plain; charset=utf-8") });
  }
  const file = Bun.file(resolved);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404, headers: headers("text/plain; charset=utf-8") });
  }
  return new Response(file, { headers: headers(contentType(resolved)) });
}

export function createAuthenticatorHttpHandler(options: { staticRoot?: string; mediapipeRoot?: string } = {}) {
  const staticRoot = resolve(options.staticRoot ?? DEFAULT_STATIC_ROOT);
  const mediapipeRoot = resolve(options.mediapipeRoot ?? DEFAULT_MEDIAPIPE_ROOT);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let response: Response;
    if (url.pathname === "/api/capabilities" && request.method === "GET") {
      const probe = new Request(request.url, { headers: { origin: url.origin } });
      response = Response.json({ environment: "staging", syntheticSelfieIssuance: allowsSyntheticIssuance(probe) });
    } else if (url.pathname === "/api/staging-rp" && request.method === "GET") {
      response = await lookupRp(request);
    } else if (url.pathname === "/api/selfie-credential" && request.method === "POST") {
      response = allowsSyntheticIssuance(request)
        ? await issueSelfie(request)
        : Response.json({ error: "Synthetic staging issuance is available only on the local authenticator." }, { status: 403 });
    } else if (url.pathname.startsWith("/api/")) {
      response = Response.json({ error: "Not found" }, { status: 404 });
    } else if (request.method !== "GET" && request.method !== "HEAD") {
      response = new Response("Method not allowed", { status: 405 });
    } else if (url.pathname.startsWith("/mediapipe/")) {
      response = await serveMediapipeRuntime(url.pathname, mediapipeRoot);
    } else {
      response = await serveStatic(url.pathname, staticRoot);
    }
    for (const [name, value] of Object.entries(AUTHENTICATOR_APP_SECURITY_HEADERS_V0)) response.headers.set(name, value);
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  };
}
