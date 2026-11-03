export type ProtocolEnvironment = "staging" | "production";

export const APP_ORIGINS = {
  staging: "https://authenticator.toolsforhumanity.dev",
  production: "https://web.world.org",
} as const;

export function parseAppEnvironment(value: unknown): ProtocolEnvironment {
  if (value === "staging" || value === "production") return value;
  throw new Error("APP_ENV must be staging or production.");
}

/** Validate where the configured build is served; the hostname never selects its network. */
export function isAllowedOrigin(environment: ProtocolEnvironment, origin: string): boolean {
  const url = new URL(origin);
  return url.origin === APP_ORIGINS[environment] || (environment === "staging" &&
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
}

export function acceptsRequestEnvironment(value: unknown, environment: ProtocolEnvironment): boolean {
  return environment === "production" ? value === "production" : value === "staging" || value === "sandbox";
}
