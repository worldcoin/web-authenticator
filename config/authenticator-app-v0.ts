export const AUTHENTICATOR_APP_SECURITY_HEADERS_V0 = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self' https://bridge.worldcoin.org https://staging-bridge.worldcoin.org https://gateway.id-infra.worldcoin.dev https://indexer.us.id-infra.worldcoin.dev https://node0.us.staging.world.oprf.taceo.network wss://node0.us.staging.world.oprf.taceo.network https://node1.us.staging.world.oprf.taceo.network wss://node1.us.staging.world.oprf.taceo.network https://node2.us.staging.world.oprf.taceo.network wss://node2.us.staging.world.oprf.taceo.network https://node3.us.staging.world.oprf.taceo.network wss://node3.us.staging.world.oprf.taceo.network https://node4.us.staging.world.oprf.taceo.network wss://node4.us.staging.world.oprf.taceo.network",
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

const ENV: Readonly<Record<string, string | undefined>> =
  process.env;

function envValue(name: string): string | undefined {
  const value = ENV[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function envPort(): number {
  const raw = envValue("PORT") ?? envValue("AUTHENTICATOR_PORT");
  if (raw === undefined) return 4173;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`authenticator_port_invalid: ${raw}`);
  }
  return port;
}

function envOrigin(name: string, fallback: string): string {
  const raw = envValue(name);
  if (raw === undefined) return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`${name}_invalid: ${raw}`);
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.pathname !== "/" || url.search !== "" || url.hash !== "" ||
    url.username !== "" || url.password !== ""
  ) {
    throw new TypeError(`${name}_must_be_a_bare_origin: ${raw}`);
  }
  return url.origin;
}

const port = envPort();
export const AUTHENTICATOR_APP_CONFIG = Object.freeze({
  host: envValue("AUTHENTICATOR_HOST") ?? "127.0.0.1",
  port,
  publicOrigin: envOrigin("AUTHENTICATOR_PUBLIC_ORIGIN", `http://127.0.0.1:${port}`),
  localOrigin: envOrigin("AUTHENTICATOR_LOCAL_ORIGIN", `http://localhost:${port}`),
});

export function allowsSyntheticIssuance(request: Request): boolean {
  const url = new URL(request.url);
  const origins = [AUTHENTICATOR_APP_CONFIG.publicOrigin, AUTHENTICATOR_APP_CONFIG.localOrigin];
  return ["127.0.0.1", "::1", "localhost"].includes(AUTHENTICATOR_APP_CONFIG.host) &&
    ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) && origins.includes(url.origin) &&
    request.headers.get("origin") === url.origin;
}
