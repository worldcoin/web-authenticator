import { connectSources, type ProtocolEnvironment } from "./environment";

/** Cloudflare drops `_headers` lines longer than this. */
const HEADERS_FILE_LINE_LIMIT = 2_000;

/** Request links carry the bridge key in their query, so this page must never be stored. */
const REQUEST_PAGE_PATH = "/verify";

/**
 * Cloudflare static-assets `_headers` file. Files keep Cloudflare's default Cache-Control, which
 * makes browsers revalidate by ETag, so a file that was missing during a deployment (answered
 * with index.html by the single-page fallback) is never pinned in a cache.
 */
export function renderHeadersFile(environment: ProtocolEnvironment): string {
  const rules: [path: string, headers: Readonly<Record<string, string>>][] = [
    ["/*", securityHeaders(environment)],
    [REQUEST_PAGE_PATH, { "Cache-Control": "no-store" }],
  ];
  const lines = rules.flatMap(([path, headers]) => [path, ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)]);
  const tooLong = lines.find(line => line.length > HEADERS_FILE_LINE_LIMIT);
  if (tooLong) throw new Error(`_headers line exceeds ${HEADERS_FILE_LINE_LIMIT} characters: ${tooLong.slice(0, 40)}…`);
  return `${lines.join("\n")}\n`;
}

/** Security headers for one environment; its CSP allows only that environment's services. */
export function securityHeaders(environment: ProtocolEnvironment): Readonly<Record<string, string>> {
  return Object.freeze({
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'none'",
      // blob: lets the WalletKit worker load the WASM the page decompressed (web/lib/walletkit-wasm.ts).
      ["connect-src 'self' blob:", ...connectSources(environment)].join(" "),
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
