export type ProtocolEnvironment = "staging" | "production";

/** A reviewed `worldcoin/tee-apps` selfie-enrollment client release policy. */
export interface SelfieEnrollmentPolicy {
  /** `wss://` endpoint of the attested enrollment service. */
  readonly endpoint: string;
  /** Accepted Nitro measurements; more than one entry only while a release rolls out. */
  readonly releases: readonly Readonly<{ pcr0: string; pcr1: string; pcr2: string }>[];
}

export interface EnvironmentConfig {
  /** The only origin this build may be served from (plus loopback for staging). */
  readonly appOrigin: string;
  /** World ID RP registry on World Chain (chain 480). */
  readonly rpRegistry: `0x${string}`;
  /** Origins the page may connect to besides 'self'; becomes CSP `connect-src`. */
  readonly connectSrc: readonly string[];
  /** Attested selfie-enrollment TEE policy, or null while extraction is off for this environment. */
  readonly selfieEnrollment: SelfieEnrollmentPolicy | null;
}

const oprfNodes = (domain: string) =>
  [0, 1, 2, 3, 4].flatMap(node => [`https://node${node}.us.${domain}`, `wss://node${node}.us.${domain}`]);

/** Services that are the same for every environment. */
export const SHARED_CONNECT_SRC: readonly string[] = Object.freeze([
  "https://wld-ml-face-engine-public.worldcoin.org", // Public face-engine model CDN.
  // Requests may arrive through either bridge; payloads are end-to-end encrypted.
  "https://bridge.worldcoin.org",
  "https://staging-bridge.worldcoin.org",
]);

/**
 * Everything that differs between staging and production. Each environment must name
 * all of its own services here; `api/test/environment.test.ts` fails if production
 * references a staging host or the two environments share a protocol service.
 */
export const ENVIRONMENTS: Readonly<Record<ProtocolEnvironment, EnvironmentConfig>> = Object.freeze({
  staging: Object.freeze({
    appOrigin: "https://authenticator.toolsforhumanity.dev",
    // Source: world-id-deploy/developer-portal/stacks/web/parameters.ts.
    rpRegistry: "0x37d2462fE7B4a07987263AAd062C6593C4f567b9",
    connectSrc: Object.freeze([
      "https://gateway.id-infra.worldcoin.dev",
      "https://indexer.us.id-infra.worldcoin.dev",
      ...oprfNodes("staging.world.oprf.taceo.network"),
    ]),
    selfieEnrollment: null,
  }),
  production: Object.freeze({
    appOrigin: "https://web.world.org",
    rpRegistry: "0xD9A213A92Bca460D56cDbBF4d775b48fB5925BbC",
    connectSrc: Object.freeze([
      "https://gateway.id-infra.world.org",
      "https://indexer.us.id-infra.world.org",
      ...oprfNodes("world.oprf.taceo.network"),
    ]),
    // Off until worldcoin/tee-apps publishes a production client release policy.
    selfieEnrollment: null,
  }),
});

export const APP_ORIGINS = Object.freeze({
  staging: ENVIRONMENTS.staging.appOrigin,
  production: ENVIRONMENTS.production.appOrigin,
} as const);

/** CSP `connect-src` sources for one environment, including its TEE endpoint when enabled. */
export function connectSources(environment: ProtocolEnvironment): readonly string[] {
  const config = ENVIRONMENTS[environment];
  const endpoint = config.selfieEnrollment ? new URL(config.selfieEnrollment.endpoint) : undefined;
  const tee = endpoint ? [`${endpoint.protocol}//${endpoint.host}`] : [];
  return [...SHARED_CONNECT_SRC, ...config.connectSrc, ...tee];
}

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
