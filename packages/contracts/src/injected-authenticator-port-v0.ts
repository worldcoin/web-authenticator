import type { HexSha256, Identifier, IsoDateTime, RuntimeEnvironment } from "./common";
import {
  assertSimulationArtifactAllowed,
  hasExactKeys,
  isHexSha256,
  isIsoDateTime,
  isRecord,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
} from "./common";

export const INJECTED_AUTHENTICATOR_PORT_V0 = "injected_authenticator_port_v0" as const;
export const INJECTED_AUTHENTICATOR_REQUEST_V0 = "injected_authenticator_request_v0" as const;
export const STAGING_DEMO_AUTHENTICATOR_READY_V0 = "staging_demo_authenticator_ready_v0" as const;
export const STAGING_DEMO_AUTHENTICATOR_ERROR_V0 = "staging_demo_authenticator_error_v0" as const;

export const STAGING_DEMO_AUTHENTICATOR_ERROR_REASONS_V0 = Object.freeze([
  "user_non_completion",
  "unavailable",
  "interrupted",
  "transport_failure",
  "invalid_response",
] as const);

export type StagingDemoAuthenticatorErrorReasonV0 =
  (typeof STAGING_DEMO_AUTHENTICATOR_ERROR_REASONS_V0)[number];

export interface InjectedAuthenticatorRequestV0 {
  readonly kind: typeof INJECTED_AUTHENTICATOR_REQUEST_V0;
  readonly version: typeof INJECTED_AUTHENTICATOR_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly requestedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export interface StagingDemoAuthenticatorReadyV0 {
  readonly kind: typeof STAGING_DEMO_AUTHENTICATOR_READY_V0;
  readonly version: typeof INJECTED_AUTHENTICATOR_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly completionHandle: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly claims: {
    readonly webauthnPerformed: false;
    readonly prfEvaluated: false;
    readonly worldIdCreated: false;
  };
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export interface StagingDemoAuthenticatorErrorV0 {
  readonly kind: typeof STAGING_DEMO_AUTHENTICATOR_ERROR_V0;
  readonly version: typeof INJECTED_AUTHENTICATOR_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly reasonCode: StagingDemoAuthenticatorErrorReasonV0;
}

export type InjectedAuthenticatorResultV0 =
  | StagingDemoAuthenticatorReadyV0
  | StagingDemoAuthenticatorErrorV0;

export interface ExpectedStagingDemoAuthenticatorReadyV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly requestRequestedAt: IsoDateTime;
  readonly requestExpiresAt: IsoDateTime;
  readonly now: IsoDateTime;
}

export interface ExpectedStagingDemoAuthenticatorErrorV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly requestId: Identifier;
  readonly sessionId: Identifier;
  readonly idempotencyKey: Identifier;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validWindow(start: unknown, end: unknown): boolean {
  return isIsoDateTime(start) && isIsoDateTime(end) && Date.parse(end) > Date.parse(start);
}

export function isInjectedAuthenticatorRequestV0(
  value: unknown,
): value is InjectedAuthenticatorRequestV0 {
  try {
    if (!isRecord(value)) return false;
    return (
      hasExactKeys(value, [
        "kind",
        "version",
        "mode",
        "environment",
        "requestId",
        "sessionId",
        "idempotencyKey",
        "accountPublicMaterialDigestSha256",
        "requestedAt",
        "expiresAt",
      ]) &&
      value.kind === INJECTED_AUTHENTICATOR_REQUEST_V0 &&
      value.version === INJECTED_AUTHENTICATOR_PORT_V0 &&
      value.mode === SIMULATION_MODE &&
      value.environment === SIMULATION_ENVIRONMENT &&
      nonEmpty(value.requestId) &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.idempotencyKey) &&
      isHexSha256(value.accountPublicMaterialDigestSha256) &&
      validWindow(value.requestedAt, value.expiresAt)
    );
  } catch {
    return false;
  }
}

export function isStagingDemoAuthenticatorReadyV0(
  value: unknown,
): value is StagingDemoAuthenticatorReadyV0 {
  try {
    if (!isRecord(value)) return false;
    const claims = value.claims;
    return (
      hasExactKeys(value, [
        "kind",
        "version",
        "mode",
        "environment",
        "requestId",
        "sessionId",
        "idempotencyKey",
        "completionHandle",
        "accountPublicMaterialDigestSha256",
        "claims",
        "issuedAt",
        "expiresAt",
      ]) &&
      value.kind === STAGING_DEMO_AUTHENTICATOR_READY_V0 &&
      value.version === INJECTED_AUTHENTICATOR_PORT_V0 &&
      value.mode === SIMULATION_MODE &&
      value.environment === SIMULATION_ENVIRONMENT &&
      nonEmpty(value.requestId) &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.idempotencyKey) &&
      nonEmpty(value.completionHandle) &&
      isHexSha256(value.accountPublicMaterialDigestSha256) &&
      isRecord(claims) &&
      hasExactKeys(claims, ["webauthnPerformed", "prfEvaluated", "worldIdCreated"]) &&
      claims.webauthnPerformed === false &&
      claims.prfEvaluated === false &&
      claims.worldIdCreated === false &&
      validWindow(value.issuedAt, value.expiresAt)
    );
  } catch {
    return false;
  }
}

export function isStagingDemoAuthenticatorErrorV0(
  value: unknown,
): value is StagingDemoAuthenticatorErrorV0 {
  try {
    if (!isRecord(value)) return false;
    return (
      hasExactKeys(value, [
        "kind",
        "version",
        "mode",
        "environment",
        "requestId",
        "sessionId",
        "idempotencyKey",
        "reasonCode",
      ]) &&
      value.kind === STAGING_DEMO_AUTHENTICATOR_ERROR_V0 &&
      value.version === INJECTED_AUTHENTICATOR_PORT_V0 &&
      value.mode === SIMULATION_MODE &&
      value.environment === SIMULATION_ENVIRONMENT &&
      nonEmpty(value.requestId) &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.idempotencyKey) &&
      typeof value.reasonCode === "string" &&
      STAGING_DEMO_AUTHENTICATOR_ERROR_REASONS_V0.includes(
        value.reasonCode as StagingDemoAuthenticatorErrorReasonV0,
      )
    );
  } catch {
    return false;
  }
}

export function matchesExpectedStagingDemoAuthenticatorReadyV0(
  value: unknown,
  expected: ExpectedStagingDemoAuthenticatorReadyV0,
): value is StagingDemoAuthenticatorReadyV0 {
  assertSimulationArtifactAllowed(expected.runtimeEnvironment, value);
  try {
    return (
      isIsoDateTime(expected.now) &&
      isIsoDateTime(expected.requestRequestedAt) &&
      isIsoDateTime(expected.requestExpiresAt) &&
      isStagingDemoAuthenticatorReadyV0(value) &&
      value.requestId === expected.requestId &&
      value.sessionId === expected.sessionId &&
      value.idempotencyKey === expected.idempotencyKey &&
      value.accountPublicMaterialDigestSha256 === expected.accountPublicMaterialDigestSha256 &&
      Date.parse(value.issuedAt) >= Date.parse(expected.requestRequestedAt) &&
      Date.parse(value.expiresAt) <= Date.parse(expected.requestExpiresAt) &&
      Date.parse(value.issuedAt) <= Date.parse(expected.now) &&
      Date.parse(value.expiresAt) > Date.parse(expected.now)
    );
  } catch {
    return false;
  }
}

export function matchesExpectedStagingDemoAuthenticatorErrorV0(
  value: unknown,
  expected: ExpectedStagingDemoAuthenticatorErrorV0,
): value is StagingDemoAuthenticatorErrorV0 {
  assertSimulationArtifactAllowed(expected.runtimeEnvironment, value);
  try {
    return (
      isStagingDemoAuthenticatorErrorV0(value) &&
      value.requestId === expected.requestId &&
      value.sessionId === expected.sessionId &&
      value.idempotencyKey === expected.idempotencyKey
    );
  } catch {
    return false;
  }
}

export interface InjectedAuthenticatorPortV0 {
  begin(request: InjectedAuthenticatorRequestV0): Promise<InjectedAuthenticatorResultV0>;
}

// This port is an explicit staging compatibility seam. It performs no WebAuthn,
// PRF evaluation, World ID key derivation, registration, or returning authentication.
