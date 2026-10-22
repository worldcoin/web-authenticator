import { resolve, relative, sep } from "node:path";

// Both api/lib/ (source) and api/dist/ (bundle) sit two levels below the repo root.
export const DEFAULT_STATIC_ROOT = resolve(import.meta.dir, "../../web/dist");

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if ((pathname.endsWith(".js") || pathname.endsWith(".mjs"))) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

async function serveFile(pathname: string, staticRoot: string): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")) return notFound();
  const assetPath = decoded === "/" ? "index.html" : decoded.replace(/^\//, "");
  const resolved = resolve(staticRoot, assetPath);
  const withinRoot = relative(staticRoot, resolved);
  if (withinRoot.startsWith(`..${sep}`) || withinRoot === ".." || withinRoot.startsWith(sep)) return notFound();
  const file = Bun.file(resolved);
  if (!(await file.exists())) return notFound();
  return new Response(file, { headers: { "Content-Type": contentType(resolved) } });
}

// Fallback for every request that no route in routes/index.ts matched.
export async function serveStatic(request: Request, staticRoot: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const response = await serveFile(new URL(request.url).pathname, staticRoot);
  return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

export function serveIndex(staticRoot: string): Promise<Response> {
  return serveFile("/", staticRoot);
}

export function webBundleAvailable(staticRoot: string): Promise<boolean> {
  return Bun.file(resolve(staticRoot, "index.html")).exists();
}
