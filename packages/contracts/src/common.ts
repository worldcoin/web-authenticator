export type Base64Url = string;
export type HexSha256 = string;
export type IsoDateTime = string;
export type Identifier = string;

export const SIMULATION_MODE = "simulation" as const;
export const SIMULATION_ENVIRONMENT = "staging" as const;

export type RuntimeEnvironment = "development" | "test" | "staging" | "production";

export const BIOMETRIC_SIMULATION_SCENARIOS_V0 = [
  "happy_path",
  "spoof_reject",
  "capture_retry",
  "dependency_unavailable",
] as const;

export type BiometricSimulationScenarioV0 =
  (typeof BIOMETRIC_SIMULATION_SCENARIOS_V0)[number];

export const BIOMETRIC_SIMULATION_OUTCOMES_V0 = [
  "simulated_pass",
  "simulated_reject",
  "simulated_retry",
  "simulated_unavailable",
] as const;

export type BiometricSimulationOutcomeV0 =
  (typeof BIOMETRIC_SIMULATION_OUTCOMES_V0)[number];

export interface StagingAuthenticationV0 {
  readonly scheme: "staging-ed25519";
  readonly keyId: Identifier;
  readonly signatureBase64Url: Base64Url;
}

export interface StagingEd25519TrustRootV0 {
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly audience: string;
  readonly keyId: Identifier;
  readonly publicKeyRawBase64Url: Base64Url;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHexSha256(value: unknown): value is HexSha256 {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const allowed = [...allowedKeys].sort();
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
}

export function isIsoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function canonicalizeJsonV0(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Canonical V0 numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJsonV0).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalizeJsonV0(entryValue)}`)
      .join(",")}}`;
  }
  throw new TypeError("Value is not in the V0 canonical JSON domain");
}

export function stagingSignaturePreimageV0(value: Record<string, unknown>): Uint8Array {
  const authentication = value.authentication;
  if (!isRecord(authentication)) throw new TypeError("Missing staging authentication");
  const { signatureBase64Url: _omitted, ...authenticationWithoutSignature } = authentication;
  const preimage = { ...value, authentication: authenticationWithoutSignature };
  return new TextEncoder().encode(canonicalizeJsonV0(preimage));
}

export function bytesToBase64Url(bytes: Uint8Array): Base64Url {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: Base64Url): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function verifyStagingEd25519V0(
  value: Record<string, unknown>,
  trustRoot: StagingEd25519TrustRootV0,
): Promise<boolean> {
  const authentication = value.authentication;
  if (!isRecord(authentication)) return false;
  if (
    authentication.scheme !== "staging-ed25519" ||
    authentication.keyId !== trustRoot.keyId ||
    value.environment !== trustRoot.environment ||
    value.audience !== trustRoot.audience ||
    typeof authentication.signatureBase64Url !== "string"
  ) {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      bytesToArrayBuffer(base64UrlToBytes(trustRoot.publicKeyRawBase64Url)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      bytesToArrayBuffer(base64UrlToBytes(authentication.signatureBase64Url)),
      bytesToArrayBuffer(stagingSignaturePreimageV0(value)),
    );
  } catch {
    return false;
  }
}

export class SimulationArtifactInProductionError extends Error {
  constructor() {
    super("Simulation artifacts are forbidden in production");
    this.name = "SimulationArtifactInProductionError";
  }
}

export function assertSimulationArtifactAllowed(
  runtimeEnvironment: RuntimeEnvironment,
  value: unknown,
): void {
  if (runtimeEnvironment !== "production") return;
  try {
    if (!isRecord(value)) return;
    const kind = value.kind;
    const mode = value.mode;
    const environment = value.environment;
    const isSimulationKind =
      kind === "simulation_receipt_v0" ||
      kind === "simulated_staging_credential_v0" ||
      kind === "injected_authenticator_request_v0" ||
      kind === "staging_demo_authenticator_ready_v0" ||
      kind === "staging_demo_authenticator_error_v0" ||
      kind === "simulator_ui_bootstrap_v0" ||
      kind === "simulator_browser_demo_authenticator_ready_v0" ||
      kind === "simulator_browser_session_view_v0" ||
      kind === "simulator_browser_session_error_v0" ||
      kind === "simulator_browser_return_accepted_v0" ||
      kind === "simulated_workflow_artifact_summary_v0" ||
      kind === "authenticator_ui_snapshot_v1" ||
      kind === "authenticator_ui_event_v1";

    if (isSimulationKind || mode === SIMULATION_MODE || environment === SIMULATION_ENVIRONMENT) {
      throw new SimulationArtifactInProductionError();
    }
  } catch {
    throw new SimulationArtifactInProductionError();
  }
}
