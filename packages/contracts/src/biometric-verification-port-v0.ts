import type {
  BiometricSimulationOutcomeV0,
  BiometricSimulationScenarioV0,
  HexSha256,
  Identifier,
  IsoDateTime,
  RuntimeEnvironment,
  StagingAuthenticationV0,
  StagingEd25519TrustRootV0,
} from "./common";
import {
  assertSimulationArtifactAllowed,
  BIOMETRIC_SIMULATION_OUTCOMES_V0,
  BIOMETRIC_SIMULATION_SCENARIOS_V0,
  hasExactKeys,
  isHexSha256,
  isIsoDateTime,
  isRecord,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  verifyStagingEd25519V0,
} from "./common";
import type { FrameBundleV0 } from "./frame-bundle-v0";
import { validateFrameBundleV0 } from "./frame-bundle-v0";
import type { SimulationCapturePolicyV0 } from "./simulation-capture-policy-v0";

export const BIOMETRIC_VERIFICATION_PORT_V0 = "biometric_verification_port_v0" as const;
export const BIOMETRIC_SIMULATION_REQUEST_V0 = "biometric_simulation_request_v0" as const;
export const SIMULATION_RECEIPT_V0 = "simulation_receipt_v0" as const;
export const BIOMETRIC_SIMULATOR_AUDIENCE_V0 =
  "world_id_web_authenticator_biometric_simulator_staging" as const;

export const BIOMETRIC_SCENARIO_OUTCOME_V0: Readonly<
  Record<BiometricSimulationScenarioV0, BiometricSimulationOutcomeV0>
> = {
  happy_path: "simulated_pass",
  spoof_reject: "simulated_reject",
  capture_retry: "simulated_retry",
  dependency_unavailable: "simulated_unavailable",
};

export const BIOMETRIC_SCENARIO_REASON_V0 = {
  happy_path: "scenario_happy_path",
  spoof_reject: "scenario_spoof_reject",
  capture_retry: "scenario_capture_retry",
  dependency_unavailable: "scenario_dependency_unavailable",
} as const;

export type BiometricSimulationReasonV0 =
  (typeof BIOMETRIC_SCENARIO_REASON_V0)[BiometricSimulationScenarioV0];

export interface BiometricSimulationRequestV0 {
  readonly kind: typeof BIOMETRIC_SIMULATION_REQUEST_V0;
  readonly version: typeof BIOMETRIC_VERIFICATION_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly audience: typeof BIOMETRIC_SIMULATOR_AUDIENCE_V0;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly nonceDigestSha256: HexSha256;
  readonly idempotencyKey: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly capturePolicyId: Identifier;
  readonly scenario: BiometricSimulationScenarioV0;
  readonly frameBundle: FrameBundleV0;
  readonly requestedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly authentication: StagingAuthenticationV0;
}

export interface SimulationReceiptV0 {
  readonly kind: typeof SIMULATION_RECEIPT_V0;
  readonly version: typeof BIOMETRIC_VERIFICATION_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly audience: typeof BIOMETRIC_SIMULATOR_AUDIENCE_V0;
  readonly receiptId: Identifier;
  readonly requestId: Identifier;
  readonly simulatorVersion: string;
  readonly scenario: BiometricSimulationScenarioV0;
  readonly sessionId: Identifier;
  readonly nonceDigestSha256: HexSha256;
  readonly idempotencyKey: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly capturePolicyId: Identifier;
  readonly artifactDigestSha256: HexSha256;
  readonly outcome: BiometricSimulationOutcomeV0;
  readonly reasonCode: BiometricSimulationReasonV0;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly authentication: StagingAuthenticationV0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStagingAuthenticationV0(value: unknown): value is StagingAuthenticationV0 {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["scheme", "keyId", "signatureBase64Url"]) &&
    value.scheme === "staging-ed25519" &&
    isNonEmptyString(value.keyId) &&
    isNonEmptyString(value.signatureBase64Url)
  );
}

function isBiometricScenarioV0(value: unknown): value is BiometricSimulationScenarioV0 {
  return (
    typeof value === "string" &&
    BIOMETRIC_SIMULATION_SCENARIOS_V0.includes(value as BiometricSimulationScenarioV0)
  );
}

function hasValidTimeWindow(issuedAt: unknown, expiresAt: unknown): boolean {
  return (
    isIsoDateTime(issuedAt) &&
    isIsoDateTime(expiresAt) &&
    Date.parse(expiresAt) > Date.parse(issuedAt)
  );
}

export function isBiometricSimulationRequestV0(
  value: unknown,
): value is BiometricSimulationRequestV0 {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      "kind",
      "version",
      "mode",
      "environment",
      "audience",
      "requestId",
      "sessionId",
      "nonceDigestSha256",
      "idempotencyKey",
      "accountPublicMaterialDigestSha256",
      "capturePolicyId",
      "scenario",
      "frameBundle",
      "requestedAt",
      "expiresAt",
      "authentication",
    ])
  ) {
    return false;
  }
  return (
    value.kind === BIOMETRIC_SIMULATION_REQUEST_V0 &&
    value.version === BIOMETRIC_VERIFICATION_PORT_V0 &&
    value.mode === SIMULATION_MODE &&
    value.environment === SIMULATION_ENVIRONMENT &&
    value.audience === BIOMETRIC_SIMULATOR_AUDIENCE_V0 &&
    isNonEmptyString(value.requestId) &&
    isNonEmptyString(value.sessionId) &&
    isHexSha256(value.nonceDigestSha256) &&
    isNonEmptyString(value.idempotencyKey) &&
    isHexSha256(value.accountPublicMaterialDigestSha256) &&
    isNonEmptyString(value.capturePolicyId) &&
    isBiometricScenarioV0(value.scenario) &&
    isRecord(value.frameBundle) &&
    hasValidTimeWindow(value.requestedAt, value.expiresAt) &&
    isStagingAuthenticationV0(value.authentication)
  );
}

export function isSimulationReceiptV0(value: unknown): value is SimulationReceiptV0 {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      "kind",
      "version",
      "mode",
      "environment",
      "audience",
      "receiptId",
      "requestId",
      "simulatorVersion",
      "scenario",
      "sessionId",
      "nonceDigestSha256",
      "idempotencyKey",
      "accountPublicMaterialDigestSha256",
      "capturePolicyId",
      "artifactDigestSha256",
      "outcome",
      "reasonCode",
      "issuedAt",
      "expiresAt",
      "authentication",
    ])
  ) {
    return false;
  }
  if (!isBiometricScenarioV0(value.scenario)) return false;
  return (
    value.kind === SIMULATION_RECEIPT_V0 &&
    value.version === BIOMETRIC_VERIFICATION_PORT_V0 &&
    value.mode === SIMULATION_MODE &&
    value.environment === SIMULATION_ENVIRONMENT &&
    value.audience === BIOMETRIC_SIMULATOR_AUDIENCE_V0 &&
    isNonEmptyString(value.receiptId) &&
    isNonEmptyString(value.requestId) &&
    isNonEmptyString(value.simulatorVersion) &&
    isNonEmptyString(value.sessionId) &&
    isHexSha256(value.nonceDigestSha256) &&
    isNonEmptyString(value.idempotencyKey) &&
    isHexSha256(value.accountPublicMaterialDigestSha256) &&
    isNonEmptyString(value.capturePolicyId) &&
    isHexSha256(value.artifactDigestSha256) &&
    typeof value.outcome === "string" &&
    BIOMETRIC_SIMULATION_OUTCOMES_V0.includes(
      value.outcome as BiometricSimulationOutcomeV0,
    ) &&
    value.outcome === BIOMETRIC_SCENARIO_OUTCOME_V0[value.scenario] &&
    value.reasonCode === BIOMETRIC_SCENARIO_REASON_V0[value.scenario] &&
    hasValidTimeWindow(value.issuedAt, value.expiresAt) &&
    isStagingAuthenticationV0(value.authentication)
  );
}

export interface ExpectedBiometricSimulationRequestV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly nonceDigestSha256: HexSha256;
  readonly idempotencyKey: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly capturePolicyId: Identifier;
  readonly scenario: BiometricSimulationScenarioV0;
  readonly now: IsoDateTime;
}

export async function verifyBiometricSimulationRequestV0(
  value: unknown,
  expected: ExpectedBiometricSimulationRequestV0,
  capturePolicy: SimulationCapturePolicyV0,
  trustRoot: StagingEd25519TrustRootV0,
): Promise<boolean> {
  assertSimulationArtifactAllowed(expected.runtimeEnvironment, value);
  if (!isBiometricSimulationRequestV0(value)) return false;
  if (
    value.requestId !== expected.requestId ||
    value.sessionId !== expected.sessionId ||
    value.nonceDigestSha256 !== expected.nonceDigestSha256 ||
    value.idempotencyKey !== expected.idempotencyKey ||
    value.accountPublicMaterialDigestSha256 !== expected.accountPublicMaterialDigestSha256 ||
    value.capturePolicyId !== expected.capturePolicyId ||
    value.scenario !== expected.scenario ||
    value.frameBundle.sessionId !== expected.sessionId ||
    value.frameBundle.nonceDigestSha256 !== expected.nonceDigestSha256 ||
    value.frameBundle.accountPublicMaterialDigestSha256 !==
      expected.accountPublicMaterialDigestSha256 ||
    value.frameBundle.policyId !== expected.capturePolicyId ||
    Date.parse(value.requestedAt) > Date.parse(expected.now) ||
    Date.parse(value.expiresAt) <= Date.parse(expected.now)
  ) {
    return false;
  }
  if ((await validateFrameBundleV0(value.frameBundle, capturePolicy)).length > 0) return false;
  return verifyStagingEd25519V0(value as unknown as Record<string, unknown>, trustRoot);
}

export interface ExpectedSimulationReceiptV0
  extends Omit<ExpectedBiometricSimulationRequestV0, "runtimeEnvironment" | "now"> {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly receiptId: Identifier;
  readonly artifactDigestSha256: HexSha256;
  readonly now: IsoDateTime;
}

export async function verifySimulationReceiptV0(
  value: unknown,
  expected: ExpectedSimulationReceiptV0,
  trustRoot: StagingEd25519TrustRootV0,
): Promise<boolean> {
  assertSimulationArtifactAllowed(expected.runtimeEnvironment, value);
  if (!isSimulationReceiptV0(value)) return false;
  if (
    value.receiptId !== expected.receiptId ||
    value.requestId !== expected.requestId ||
    value.sessionId !== expected.sessionId ||
    value.nonceDigestSha256 !== expected.nonceDigestSha256 ||
    value.idempotencyKey !== expected.idempotencyKey ||
    value.accountPublicMaterialDigestSha256 !== expected.accountPublicMaterialDigestSha256 ||
    value.capturePolicyId !== expected.capturePolicyId ||
    value.artifactDigestSha256 !== expected.artifactDigestSha256 ||
    value.scenario !== expected.scenario ||
    Date.parse(value.issuedAt) > Date.parse(expected.now) ||
    Date.parse(value.expiresAt) <= Date.parse(expected.now)
  ) {
    return false;
  }
  return verifyStagingEd25519V0(value as unknown as Record<string, unknown>, trustRoot);
}

// The simulator uses authenticated scenario mapping, never pixels or a browser spoof score.
