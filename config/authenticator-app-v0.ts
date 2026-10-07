import {
  SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
  SIMULATOR_UI_QUALITY_POLICY_V0,
  type BiometricSimulationScenarioV0,
  type IssuanceSimulationScenarioV0,
} from "../packages/contracts/src";

export const AUTHENTICATOR_APP_CONFIG_V0 = "authenticator_app_config_v0" as const;

export const AUTHENTICATOR_APP_SECURITY_HEADERS_V0 = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
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

export interface AuthenticatorRpPresentationV0 {
  readonly displayName: "Zoom";
  readonly iconAssetId: "zoom";
  readonly returnLabel: "Return to Zoom";
  readonly returnPath: "/returned";
}

export const AUTHENTICATOR_RP_PRESENTATIONS_V0 = Object.freeze({
  zoom_demo: Object.freeze<AuthenticatorRpPresentationV0>({
    displayName: "Zoom",
    iconAssetId: "zoom",
    returnLabel: "Return to Zoom",
    returnPath: "/returned",
  }),
});

export interface AuthenticatorAppConfigV0 {
  readonly version: typeof AUTHENTICATOR_APP_CONFIG_V0;
  readonly runtimeEnvironment: "staging";
  /** Bind address. `AUTHENTICATOR_HOST`; default `127.0.0.1`. Containers use `0.0.0.0`. */
  readonly host: string;
  /** Listening port. `PORT` or `AUTHENTICATOR_PORT`; default `4173`. */
  readonly port: number;
  /** Exact browser origin allowed to call the API. `AUTHENTICATOR_PUBLIC_ORIGIN`; default `http://127.0.0.1:<port>`. */
  readonly publicOrigin: string;
  /** Second exact origin for the local walkthrough. `AUTHENTICATOR_LOCAL_ORIGIN`; default `http://localhost:<port>`. */
  readonly localWalkthroughOrigin: string;
  /** Relying-party identifier bound into sessions: the public origin's hostname. */
  readonly rpId: string;
  readonly gatewayEnabled: true;
  readonly sessionTtlMs: 300_000;
  readonly simulatorTimeoutMs: 5_000;
  readonly maxRequestBodyBytes: 65_536;
  readonly maxConcurrentOperations: 8;
  readonly biometricSimulatorVersion: "cs5-simulated-biometric-v0";
  readonly biometricReceiptTtlMs: 60_000;
  readonly biometricCacheEntries: 1_024;
  readonly stagingCredentialTtlMs: 60_000;
  readonly issuanceCacheEntries: 1_024;
  readonly demoCompletionTtlMs: 60_000;
  readonly purposeKeyIds: {
    readonly biometricRequest: "cs5-biometric-request";
    readonly biometricReceipt: "cs5-biometric-receipt";
    readonly issuanceRequest: "cs5-issuance-request";
    readonly simulatedCredential: "cs5-simulated-credential";
    readonly demoCompletion: "cs5-demo-completion";
  };
  readonly allowedSyntheticFixtureIds: readonly ["fixture-neutral-v0"];
  readonly demoAccountId: "simulated-account-cs5";
  readonly demoAccountPublicMaterialDigestSha256: string;
  readonly defaultBiometricScenario: BiometricSimulationScenarioV0;
  readonly defaultIssuanceScenario: IssuanceSimulationScenarioV0;
  readonly capturePolicy: typeof SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0;
  readonly qualityPolicy: typeof SIMULATOR_UI_QUALITY_POLICY_V0;
}

// Server binding and allowed origins come from the environment so the same
// build runs on loopback and behind an HTTPS host. Invalid values fail at
// startup instead of silently falling back.
// Read through globalThis so this module also loads in the browser-hosted
// static demo, where there is no `process`; there, every value falls back.
const ENV: Readonly<Record<string, string | undefined>> =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

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

const BINDING = (() => {
  const port = envPort();
  const publicOrigin = envOrigin("AUTHENTICATOR_PUBLIC_ORIGIN", `http://127.0.0.1:${port}`);
  return Object.freeze({
    host: envValue("AUTHENTICATOR_HOST") ?? "127.0.0.1",
    port,
    publicOrigin,
    localWalkthroughOrigin: envOrigin("AUTHENTICATOR_LOCAL_ORIGIN", `http://localhost:${port}`),
    rpId: new URL(publicOrigin).hostname,
  });
})();

export const AUTHENTICATOR_APP_CONFIG: AuthenticatorAppConfigV0 = Object.freeze({
  version: AUTHENTICATOR_APP_CONFIG_V0,
  runtimeEnvironment: "staging",
  host: BINDING.host,
  port: BINDING.port,
  publicOrigin: BINDING.publicOrigin,
  localWalkthroughOrigin: BINDING.localWalkthroughOrigin,
  rpId: BINDING.rpId,
  gatewayEnabled: true,
  sessionTtlMs: 300_000,
  simulatorTimeoutMs: 5_000,
  maxRequestBodyBytes: 65_536,
  maxConcurrentOperations: 8,
  biometricSimulatorVersion: "cs5-simulated-biometric-v0",
  biometricReceiptTtlMs: 60_000,
  biometricCacheEntries: 1_024,
  stagingCredentialTtlMs: 60_000,
  issuanceCacheEntries: 1_024,
  demoCompletionTtlMs: 60_000,
  purposeKeyIds: Object.freeze({
    biometricRequest: "cs5-biometric-request",
    biometricReceipt: "cs5-biometric-receipt",
    issuanceRequest: "cs5-issuance-request",
    simulatedCredential: "cs5-simulated-credential",
    demoCompletion: "cs5-demo-completion",
  }),
  allowedSyntheticFixtureIds: Object.freeze(["fixture-neutral-v0"] as const),
  demoAccountId: "simulated-account-cs5",
  demoAccountPublicMaterialDigestSha256: "0".repeat(64),
  defaultBiometricScenario: "happy_path",
  defaultIssuanceScenario: "issue_success",
  capturePolicy: SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
  qualityPolicy: SIMULATOR_UI_QUALITY_POLICY_V0,
});

// The default scenarios are server-owned staging configuration. Browser input,
// query parameters, and client-quality results cannot change them.
