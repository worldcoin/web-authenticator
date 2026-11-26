import { connectSources, type ProtocolEnvironment } from "./environment";

/** Cloudflare drops `_headers` lines longer than this. */
const HEADERS_FILE_LINE_LIMIT = 2_000;

/** Directories that hold only files: Vite's output and web/public. Every other path may be a page. */
const FILE_DIRECTORIES = ["assets", "fonts"];
const REVALIDATE = "public, max-age=0, must-revalidate";

/**
 * Cloudflare static-assets `_headers` file. Pages are never stored, because a request link carries
 * the bridge key in its query and the single-page fallback serves the app on any path. Files are
 * revalidated by ETag, not cached as immutable, so a file that was missing during a deployment
 * (answered with index.html by the fallback) is never pinned in a cache.
 */
export function renderHeadersFile(environment: ProtocolEnvironment): string {
  const lines = [
    "/*",
    ...Object.entries({ ...securityHeaders(environment), "Cache-Control": "no-store" }).map(([name, value]) => `  ${name}: ${value}`),
    // "!" detaches the value inherited from "/*"; without it Cloudflare joins both values.
    ...FILE_DIRECTORIES.flatMap(directory => [`/${directory}/*`, "  ! Cache-Control", `  Cache-Control: ${REVALIDATE}`]),
  ];
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
