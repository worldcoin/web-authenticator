import { AUTHENTICATOR_APP_SECURITY_HEADERS_V0 } from "./config";

export type Handler = (request: Request) => Response | Promise<Response>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteTable = Record<string, Handler | Partial<Record<Method, Handler>>>;

function applySecurityHeaders(response: Response): Response {
  try {
    for (const [name, value] of Object.entries(AUTHENTICATOR_APP_SECURITY_HEADERS_V0)) response.headers.set(name, value);
    return response;
  } catch {
    // Response.redirect() and Response.error() have immutable headers.
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(AUTHENTICATOR_APP_SECURITY_HEADERS_V0)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

export function withSecurityHeaders(handler: Handler): Handler {
  return async request => applySecurityHeaders(await handler(request));
}

// Applied once here so a new route cannot ship without the security headers.
export function secureRoutes(routes: RouteTable): RouteTable {
  return Object.fromEntries(Object.entries(routes).map(([path, route]) => [
    path,
    typeof route === "function"
      ? withSecurityHeaders(route)
      : Object.fromEntries(Object.entries(route).flatMap(([method, handler]) =>
        handler === undefined ? [] : [[method, withSecurityHeaders(handler)]])),
  ]));
}

export function internalError(error: Error): Response {
  // eslint-disable-next-line no-console -- Unhandled request failure; message only, no request material.
  console.error("request_unhandled_error", { name: error.name, message: error.message });
  return applySecurityHeaders(Response.json({ error: "Internal server error" }, { status: 500 }));
}
