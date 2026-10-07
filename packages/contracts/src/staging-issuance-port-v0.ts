import type {
  HexSha256,
  Identifier,
  IsoDateTime,
  RuntimeEnvironment,
  StagingAuthenticationV0,
  StagingEd25519TrustRootV0,
} from "./common";
import {
  assertSimulationArtifactAllowed,
  hasExactKeys,
  isHexSha256,
  isIsoDateTime,
  isRecord,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  verifyStagingEd25519V0,
} from "./common";
import type {
  ExpectedSimulationReceiptV0,
  SimulationReceiptV0,
} from "./biometric-verification-port-v0";
import {
  isSimulationReceiptV0,
  verifySimulationReceiptV0,
} from "./biometric-verification-port-v0";

export const STAGING_ISSUANCE_PORT_V0 = "staging_issuance_port_v0" as const;
export const STAGING_ISSUANCE_SIMULATION_REQUEST_V0 =
  "staging_issuance_simulation_request_v0" as const;
export const STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0 =
  "world_id_web_authenticator_issuance_simulator_staging" as const;
export const SIMULATED_STAGING_CREDENTIAL_V0 = "simulated_staging_credential_v0" as const;
export const SIMULATED_STAGING_ISSUER_V0 = "world_id_web_authenticator_simulator" as const;
export const SIMULATED_STAGING_AUDIENCE_V0 =
  "world_id_web_authenticator_staging" as const;

export const ISSUANCE_SIMULATION_SCENARIOS_V0 = [
  "issue_success",
  "issue_reject",
  "issue_unavailable",
] as const;

export type IssuanceSimulationScenarioV0 =
  (typeof ISSUANCE_SIMULATION_SCENARIOS_V0)[number];

export interface StagingIssuanceSimulationRequestV0 {
  readonly kind: typeof STAGING_ISSUANCE_SIMULATION_REQUEST_V0;
  readonly version: typeof STAGING_ISSUANCE_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly audience: typeof STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly nonceDigestSha256: HexSha256;
  readonly idempotencyKey: Identifier;
  readonly accountId: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly biometricReceipt: SimulationReceiptV0 & { readonly outcome: "simulated_pass" };
  readonly scenario: IssuanceSimulationScenarioV0;
  readonly requestedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly authentication: StagingAuthenticationV0;
}

export interface SimulatedStagingCredentialV0 {
  readonly kind: typeof SIMULATED_STAGING_CREDENTIAL_V0;
  readonly version: typeof STAGING_ISSUANCE_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly credentialId: Identifier;
  readonly issuer: typeof SIMULATED_STAGING_ISSUER_V0;
  readonly audience: typeof SIMULATED_STAGING_AUDIENCE_V0;
  readonly issuanceRequestId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly nonceDigestSha256: HexSha256;
  readonly subjectAccountId: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly simulationReceiptId: Identifier;
  readonly claims: {
    readonly biometricVerification: "simulated_not_performed";
    readonly uniqueness: "not_performed";
    readonly credentialClass: "not_selfie_check";
  };
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly authentication: StagingAuthenticationV0;
}

export type StagingIssuanceSimulationResultV0 =
  | {
      readonly kind: "simulated_credential_ready_v0";
      readonly credential: SimulatedStagingCredentialV0;
    }
  | {
      readonly kind: "simulated_issuance_rejected_v0";
      readonly reasonCode: "scenario_issue_reject";
    }
  | {
      readonly kind: "simulated_issuance_unavailable_v0";
      readonly reasonCode: "scenario_issue_unavailable";
    };

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

function hasValidTimeWindow(issuedAt: unknown, expiresAt: unknown): boolean {
  return (
    isIsoDateTime(issuedAt) &&
    isIsoDateTime(expiresAt) &&
    Date.parse(expiresAt) > Date.parse(issuedAt)
  );
}

export function isStagingIssuanceSimulationRequestV0(
  value: unknown,
): value is StagingIssuanceSimulationRequestV0 {
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
      "accountId",
      "accountPublicMaterialDigestSha256",
      "biometricReceipt",
      "scenario",
      "requestedAt",
      "expiresAt",
      "authentication",
    ])
  ) {
    return false;
  }
  return (
    value.kind === STAGING_ISSUANCE_SIMULATION_REQUEST_V0 &&
    value.version === STAGING_ISSUANCE_PORT_V0 &&
    value.mode === SIMULATION_MODE &&
    value.environment === SIMULATION_ENVIRONMENT &&
    value.audience === STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0 &&
    isNonEmptyString(value.requestId) &&
    isNonEmptyString(value.sessionId) &&
    isHexSha256(value.nonceDigestSha256) &&
    isNonEmptyString(value.idempotencyKey) &&
    isNonEmptyString(value.accountId) &&
    isHexSha256(value.accountPublicMaterialDigestSha256) &&
    isSimulationReceiptV0(value.biometricReceipt) &&
    value.biometricReceipt.outcome === "simulated_pass" &&
    typeof value.scenario === "string" &&
    ISSUANCE_SIMULATION_SCENARIOS_V0.includes(
      value.scenario as IssuanceSimulationScenarioV0,
    ) &&
    hasValidTimeWindow(value.requestedAt, value.expiresAt) &&
    isStagingAuthenticationV0(value.authentication)
  );
}

export function isSimulatedStagingCredentialV0(
  value: unknown,
): value is SimulatedStagingCredentialV0 {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      "kind",
      "version",
      "mode",
      "environment",
      "credentialId",
      "issuer",
      "audience",
      "issuanceRequestId",
      "idempotencyKey",
      "nonceDigestSha256",
      "subjectAccountId",
      "accountPublicMaterialDigestSha256",
      "simulationReceiptId",
      "claims",
      "issuedAt",
      "expiresAt",
      "authentication",
    ])
  ) {
    return false;
  }
  const claims = value.claims;
  return (
    value.kind === SIMULATED_STAGING_CREDENTIAL_V0 &&
    value.version === STAGING_ISSUANCE_PORT_V0 &&
    value.mode === SIMULATION_MODE &&
    value.environment === SIMULATION_ENVIRONMENT &&
    value.issuer === SIMULATED_STAGING_ISSUER_V0 &&
    value.audience === SIMULATED_STAGING_AUDIENCE_V0 &&
    isNonEmptyString(value.credentialId) &&
    isNonEmptyString(value.issuanceRequestId) &&
    isNonEmptyString(value.idempotencyKey) &&
    isHexSha256(value.nonceDigestSha256) &&
    isNonEmptyString(value.subjectAccountId) &&
    isHexSha256(value.accountPublicMaterialDigestSha256) &&
    isNonEmptyString(value.simulationReceiptId) &&
    isRecord(claims) &&
    hasExactKeys(claims, ["biometricVerification", "uniqueness", "credentialClass"]) &&
    claims.biometricVerification === "simulated_not_performed" &&
    claims.uniqueness === "not_performed" &&
    claims.credentialClass === "not_selfie_check" &&
    hasValidTimeWindow(value.issuedAt, value.expiresAt) &&
    isStagingAuthenticationV0(value.authentication)
  );
}

export interface ExpectedStagingIssuanceRequestV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly nonceDigestSha256: HexSha256;
  readonly idempotencyKey: Identifier;
  readonly accountId: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly biometricReceipt: ExpectedSimulationReceiptV0;
  readonly scenario: IssuanceSimulationScenarioV0;
  readonly now: IsoDateTime;
}

export async function verifyStagingIssuanceSimulationRequestV0(
  value: unknown,
  expected: ExpectedStagingIssuanceRequestV0,
  gatewayTrustRoot: StagingEd25519TrustRootV0,
  biometricReceiptTrustRoot: StagingEd25519TrustRootV0,
): Promise<boolean> {
  assertSimulationArtifactAllowed(expected.runtimeEnvironment, value);
  if (!isStagingIssuanceSimulationRequestV0(value)) return false;
  if (
    value.requestId !== expected.requestId ||
    value.sessionId !== expected.sessionId ||
    value.nonceDigestSha256 !== expected.nonceDigestSha256 ||
    value.idempotencyKey !== expected.idempotencyKey ||
    value.accountId !== expected.accountId ||
    value.accountPublicMaterialDigestSha256 !== expected.accountPublicMaterialDigestSha256 ||
    value.biometricReceipt.receiptId !== expected.biometricReceipt.receiptId ||
    value.biometricReceipt.sessionId !== expected.sessionId ||
    value.biometricReceipt.nonceDigestSha256 !== expected.nonceDigestSha256 ||
    value.biometricReceipt.accountPublicMaterialDigestSha256 !==
      expected.accountPublicMaterialDigestSha256 ||
    value.scenario !== expected.scenario ||
    Date.parse(value.requestedAt) > Date.parse(expected.now) ||
    Date.parse(value.expiresAt) <= Date.parse(expected.now)
  ) {
    return false;
  }
  if (
    !(await verifySimulationReceiptV0(
      value.biometricReceipt,
      expected.biometricReceipt,
      biometricReceiptTrustRoot,
    ))
  ) {
    return false;
  }
  return verifyStagingEd25519V0(
    value as unknown as Record<string, unknown>,
    gatewayTrustRoot,
  );
}

export interface ExpectedSimulatedStagingCredentialV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly issuanceRequestId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly nonceDigestSha256: HexSha256;
  readonly subjectAccountId: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly simulationReceiptId: Identifier;
  readonly now: IsoDateTime;
}

export async function verifySimulatedStagingCredentialV0(
  value: unknown,
  expected: ExpectedSimulatedStagingCredentialV0,
  trustRoot: StagingEd25519TrustRootV0,
): Promise<boolean> {
  assertSimulationArtifactAllowed(expected.runtimeEnvironment, value);
  if (!isSimulatedStagingCredentialV0(value)) return false;
  if (
    value.issuanceRequestId !== expected.issuanceRequestId ||
    value.idempotencyKey !== expected.idempotencyKey ||
    value.nonceDigestSha256 !== expected.nonceDigestSha256 ||
    value.subjectAccountId !== expected.subjectAccountId ||
    value.accountPublicMaterialDigestSha256 !== expected.accountPublicMaterialDigestSha256 ||
    value.simulationReceiptId !== expected.simulationReceiptId ||
    Date.parse(value.issuedAt) > Date.parse(expected.now) ||
    Date.parse(value.expiresAt) <= Date.parse(expected.now)
  ) {
    return false;
  }
  return verifyStagingEd25519V0(value as unknown as Record<string, unknown>, trustRoot);
}

// This type is intentionally incompatible with a real Selfie Check credential.
