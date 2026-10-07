import { resolve, relative, sep } from "node:path";
import {
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  isBrowserIdempotentSessionFieldsV0,
  isBrowserSessionFieldsV0,
  isCompleteDemoAuthenticatorV0,
  isCreateSimulatorBrowserSessionV0,
  isSubmitSimulatorCaptureShapeV0,
  type SimulatorBrowserSessionErrorCodeV0,
  type SimulatorBrowserSessionOperationV0,
  type SimulatorBrowserSessionPortV0,
} from "@clean-start/contracts";
import {
  AUTHENTICATOR_APP_CONFIG,
  AUTHENTICATOR_APP_SECURITY_HEADERS_V0,
} from "@clean-start/app-config";

const API_PREFIX = "/api/v0/";
const DEFAULT_STATIC_ROOT = resolve(import.meta.dir, "../../dist");
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

function errorBody(
  operation: SimulatorBrowserSessionOperationV0,
  reasonCode: SimulatorBrowserSessionErrorCodeV0,
) {
  return Object.freeze({
    kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
    version: SIMULATOR_BROWSER_SESSION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    operation,
    reasonCode,
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: headers("application/json; charset=utf-8"),
  });
}

function statusForReason(reasonCode: SimulatorBrowserSessionErrorCodeV0): number {
  if (reasonCode === "origin_forbidden") return 403;
  if (reasonCode === "unauthorized") return 401;
  if (reasonCode === "not_found") return 404;
  if (reasonCode === "expired") return 410;
  if (reasonCode === "body_too_large") return 413;
  if (reasonCode === "resource_busy") return 429;
  if (
    reasonCode === "invalid_state" ||
    reasonCode === "binding_mismatch" ||
    reasonCode === "replay_rejected"
  ) return 409;
  if (reasonCode === "gateway_disabled") return 503;
  return 400;
}

function operationForPath(pathname: string): SimulatorBrowserSessionOperationV0 {
  const operations: Readonly<Record<string, SimulatorBrowserSessionOperationV0>> = {
    "/api/v0/bootstrap": "bootstrap",
    "/api/v0/session/create": "create_session",
    "/api/v0/session/demo/begin": "begin_demo_authenticator",
    "/api/v0/session/demo/complete": "complete_demo_authenticator",
    "/api/v0/session/capture/prepare": "prepare_capture",
    "/api/v0/session/capture/submit": "submit_capture",
    "/api/v0/session/retry": "retry_unavailable",
    "/api/v0/session/status": "get_status",
    "/api/v0/session/cancel": "cancel",
    "/api/v0/session/return": "return_to_rp",
  };
  return operations[pathname] ?? "bootstrap";
}

function isEmptyRecord(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0;
}

async function readStrictJson(
  request: Request,
  operation: SimulatorBrowserSessionOperationV0,
): Promise<{ readonly value: unknown } | { readonly response: Response }> {
  if (request.method !== "POST") {
    return { response: json(errorBody(operation, "invalid_request"), 405) };
  }
  const origin = request.headers.get("origin");
  if (
    origin !== AUTHENTICATOR_APP_CONFIG.publicOrigin &&
    origin !== AUTHENTICATOR_APP_CONFIG.localWalkthroughOrigin
  ) {
    return { response: json(errorBody(operation, "origin_forbidden"), 403) };
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    return { response: json(errorBody(operation, "invalid_request"), 415) };
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > AUTHENTICATOR_APP_CONFIG.maxRequestBodyBytes
  ) {
    return { response: json(errorBody(operation, "body_too_large"), 413) };
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return { response: json(errorBody(operation, "invalid_request"), 400) };
  }
  if (bytes.byteLength > AUTHENTICATOR_APP_CONFIG.maxRequestBodyBytes) {
    return { response: json(errorBody(operation, "body_too_large"), 413) };
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { response: json(errorBody(operation, "invalid_request"), 400) };
  }
}

async function dispatchApi(
  browserPort: SimulatorBrowserSessionPortV0,
  request: Request,
  pathname: string,
): Promise<Response> {
  const operation = operationForPath(pathname);
  const parsed = await readStrictJson(request, operation);
  if ("response" in parsed) return parsed.response;
  const value = parsed.value;

  let result;
  if (pathname === "/api/v0/bootstrap" && isEmptyRecord(value)) {
    result = await browserPort.bootstrap();
  } else if (pathname === "/api/v0/session/create" && isCreateSimulatorBrowserSessionV0(value)) {
    result = await browserPort.createSession(value);
  } else if (pathname === "/api/v0/session/demo/begin" && isBrowserIdempotentSessionFieldsV0(value)) {
    result = await browserPort.beginDemoAuthenticator(value);
  } else if (pathname === "/api/v0/session/demo/complete" && isCompleteDemoAuthenticatorV0(value)) {
    result = await browserPort.completeDemoAuthenticator(value);
  } else if (pathname === "/api/v0/session/capture/prepare" && isBrowserSessionFieldsV0(value)) {
    result = await browserPort.prepareCapture(value);
  } else if (pathname === "/api/v0/session/capture/submit" && isSubmitSimulatorCaptureShapeV0(value)) {
    result = await browserPort.submitCapture(value);
  } else if (pathname === "/api/v0/session/retry" && isBrowserIdempotentSessionFieldsV0(value)) {
    result = await browserPort.retryUnavailable(value);
  } else if (pathname === "/api/v0/session/status" && isBrowserSessionFieldsV0(value)) {
    result = await browserPort.getStatus(value);
  } else if (pathname === "/api/v0/session/cancel" && isBrowserSessionFieldsV0(value)) {
    result = await browserPort.cancel(value);
  } else if (pathname === "/api/v0/session/return" && isBrowserSessionFieldsV0(value)) {
    result = await browserPort.returnToRp(value);
  } else {
    return json(errorBody(operation, "invalid_request"), 400);
  }

  if (result.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
    return json(result, statusForReason(result.reasonCode));
  }
  return json(result);
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
  const assetPath = ["/", "/returned", "/demo", "/demo/returned"].includes(decoded)
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

export function createAuthenticatorHttpHandlerV0(
  browserPort: SimulatorBrowserSessionPortV0,
  options: {
    readonly staticRoot?: string;
    readonly mediapipeRoot?: string;
  } = {},
): (request: Request) => Promise<Response> {
  const staticRoot = resolve(options.staticRoot ?? DEFAULT_STATIC_ROOT);
  const mediapipeRoot = resolve(options.mediapipeRoot ?? DEFAULT_MEDIAPIPE_ROOT);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API_PREFIX)) {
      const known = new Set([
        "/api/v0/bootstrap",
        "/api/v0/session/create",
        "/api/v0/session/demo/begin",
        "/api/v0/session/demo/complete",
        "/api/v0/session/capture/prepare",
        "/api/v0/session/capture/submit",
        "/api/v0/session/retry",
        "/api/v0/session/status",
        "/api/v0/session/cancel",
        "/api/v0/session/return",
      ]);
      if (!known.has(url.pathname)) {
        return json(errorBody("bootstrap", "not_found"), 404);
      }
      try {
        return await dispatchApi(browserPort, request, url.pathname);
      } catch {
        return json(errorBody(operationForPath(url.pathname), "response_invalid"), 500);
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Not found", { status: 404, headers: headers("text/plain; charset=utf-8") });
    }
    if (url.pathname.startsWith("/mediapipe/")) {
      return serveMediapipeRuntime(url.pathname, mediapipeRoot);
    }
    return serveStatic(url.pathname, staticRoot);
  };
}
