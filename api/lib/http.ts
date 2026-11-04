import type { ProtocolEnvironment } from "../../config/environment";
import { securityHeaders } from "./security-headers";

export type Handler = (request: Request) => Response | Promise<Response>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteTable = Record<string, Handler | Partial<Record<Method, Handler>>>;

/** `undefined` is a deployment with no valid environment: its CSP allows no connections. */
type HeaderEnvironment = ProtocolEnvironment | undefined;

function applySecurityHeaders(response: Response, environment: HeaderEnvironment): Response {
  const values = Object.entries(securityHeaders(environment));
  try {
    for (const [name, value] of values) response.headers.set(name, value);
    return response;
  } catch {
    // Response.redirect() and Response.error() have immutable headers.
    const headers = new Headers(response.headers);
    for (const [name, value] of values) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

export function withSecurityHeaders(handler: Handler, environment: HeaderEnvironment): Handler {
  return async request => applySecurityHeaders(await handler(request), environment);
}

// Applied once here so a new route cannot ship without the security headers.
export function secureRoutes(routes: RouteTable, environment: ProtocolEnvironment): RouteTable {
  return Object.fromEntries(Object.entries(routes).map(([path, route]) => [
    path,
    typeof route === "function"
      ? withSecurityHeaders(route, environment)
      : Object.fromEntries(Object.entries(route).flatMap(([method, handler]) =>
        handler === undefined ? [] : [[method, withSecurityHeaders(handler, environment)]])),
  ]));
}

export function internalError(error: Error, environment: HeaderEnvironment): Response {
  // eslint-disable-next-line no-console -- Unhandled request failure; message only, no request material.
  console.error("request_unhandled_error", { name: error.name, message: error.message });
  return applySecurityHeaders(Response.json({ error: "Internal server error" }, { status: 500 }), environment);
}
