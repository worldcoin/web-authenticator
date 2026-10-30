import { isClientRoute } from "./client-routes";

export const COMPRESSED_WASM_PREFIX = "/_cf/wasm";

function encodingQuality(request: Request, encoding: "gzip" | "identity"): number {
  const header = request.headers.get("accept-encoding");
  if (header === null) return 1;
  const encodings = new Map(header.toLowerCase().split(",").map(entry => {
    const [name, ...parameters] = entry.trim().split(";");
    const quality = Number(parameters.find(value => value.trim().startsWith("q="))?.trim().slice(2) ?? "1");
    return [name.trim(), Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0];
  }));
  return encodings.get(encoding) ?? (encoding === "identity" ? (encodings.get("*") === 0 ? 0 : 1) : encodings.get("*") ?? 0);
}

function assetRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  // Cookies, bridge keys, Range and conditional headers are not forwarded to storage.
  return new Request(url, { headers: { "Accept-Encoding": "identity" } });
}

export async function serveWorkerAsset(request: Request, assets: Env["ASSETS"]): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/_cf/")) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const pathname = isClientRoute(url.pathname) ? "/index.html" : url.pathname;
  const response = await assets.fetch(assetRequest(request, pathname));
  if (response.status !== 404 || !pathname.endsWith(".wasm")) {
    if (request.method === "HEAD") {
      await response.body?.cancel();
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  }
  await response.body?.cancel();
  const compressed = await assets.fetch(assetRequest(request, `${COMPRESSED_WASM_PREFIX}${pathname}.gz`));
  if (compressed.status !== 200) {
    await compressed.body?.cancel();
    return new Response("Not found", { status: compressed.status === 404 ? 404 : 503 });
  }
  const gzip = encodingQuality(request, "gzip") > 0;
  if (!gzip && encodingQuality(request, "identity") === 0) {
    await compressed.body?.cancel();
    return new Response("No acceptable content encoding", { status: 406, headers: { Vary: "Accept-Encoding" } });
  }
  const headers = new Headers({ "Content-Type": "application/wasm", Vary: "Accept-Encoding" });
  if (gzip) headers.set("Content-Encoding", "gzip");
  if (request.method === "HEAD") {
    await compressed.body?.cancel();
    return new Response(null, { headers });
  }
  // Compressed bytes are passed through untouched; other clients get a decoded stream.
  const body = gzip ? compressed.body : compressed.body?.pipeThrough(new DecompressionStream("gzip"));
  return new Response(body, { headers, encodeBody: "manual" });
}
