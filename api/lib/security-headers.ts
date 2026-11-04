import { connectSources, type ProtocolEnvironment } from "../../config/environment";

// Reads no process environment, so the Worker can import it before validating APP_ENV.
function buildSecurityHeaders(connectSrc: readonly string[]): Readonly<Record<string, string>> {
  return Object.freeze({
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'none'",
      ["connect-src 'self'", ...connectSrc].join(" "),
      "font-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' blob:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self'",
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

const SECURITY_HEADERS: Readonly<Record<ProtocolEnvironment, Readonly<Record<string, string>>>> = Object.freeze({
  staging: buildSecurityHeaders(connectSources("staging")),
  production: buildSecurityHeaders(connectSources("production")),
});
// Misconfigured deployments answer with an error only; they may not connect anywhere.
const UNCONFIGURED_SECURITY_HEADERS = buildSecurityHeaders([]);

/** Security headers for one environment; its CSP allows only that environment's services. */
export function securityHeaders(environment: ProtocolEnvironment | undefined): Readonly<Record<string, string>> {
  return environment === undefined ? UNCONFIGURED_SECURITY_HEADERS : SECURITY_HEADERS[environment];
}
