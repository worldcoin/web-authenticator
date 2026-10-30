export type ProtocolEnvironment = "staging" | "production";
export type DeploymentEnvironment = "internal" | "sandbox" | "production";

export const DEPLOYMENTS = {
  internal: { origin: "https://authenticator.toolsforhumanity.dev", protocol: "staging" },
  sandbox: { origin: "https://web.sandbox.world.org", protocol: "staging" },
  production: { origin: "https://web.world.org", protocol: "production" },
} as const;

/** The site origin selects the network; query strings and request payloads cannot override it. */
export function protocolEnvironmentForOrigin(origin: string): ProtocolEnvironment {
  const url = new URL(origin);
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "staging";
  for (const deployment of Object.values(DEPLOYMENTS)) {
    if (url.origin === deployment.origin) return deployment.protocol;
  }
  throw new Error("Unsupported authenticator origin.");
}

export function acceptsRequestEnvironment(value: unknown, environment: ProtocolEnvironment): boolean {
  return environment === "production" ? value === "production" : value === "staging" || value === "sandbox";
}
