import type {
  HexSha256,
  Identifier,
  IsoDateTime,
  RuntimeEnvironment,
} from "./common";
import {
  assertSimulationArtifactAllowed,
  hasExactKeys,
  isHexSha256,
  isIsoDateTime,
  isRecord,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
} from "./common";
import type { ClientQualityPolicyV0 } from "./client-quality-policy-v0";
import { validateClientQualityPolicyV0 } from "./client-quality-policy-v0";
import type { EnrollmentSessionStateV2 } from "./enrollment-session-v2";
import { ENROLLMENT_SESSION_STATES_V2 } from "./enrollment-session-v2";
import type { FrameBundleV0 } from "./frame-bundle-v0";
import { validateFrameBundleV0 } from "./frame-bundle-v0";
import type { SimulationCapturePolicyV0 } from "./simulation-capture-policy-v0";
import { validateSimulationCapturePolicyV0 } from "./simulation-capture-policy-v0";

export const SIMULATOR_BROWSER_SESSION_PORT_V0 = "simulator_browser_session_port_v0" as const;
export const SIMULATOR_UI_BOOTSTRAP_V0 = "simulator_ui_bootstrap_v0" as const;
export const SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0 =
  "simulator_browser_demo_authenticator_ready_v0" as const;
export const SIMULATOR_BROWSER_SESSION_VIEW_V0 = "simulator_browser_session_view_v0" as const;
export const SIMULATOR_BROWSER_SESSION_ERROR_V0 = "simulator_browser_session_error_v0" as const;
export const SIMULATOR_BROWSER_RETURN_ACCEPTED_V0 =
  "simulator_browser_return_accepted_v0" as const;
export const SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0 =
  "simulated_workflow_artifact_summary_v0" as const;

export const RP_PRESENTATION_IDS_V0 = Object.freeze(["zoom_demo"] as const);
export type RpPresentationIdV0 = (typeof RP_PRESENTATION_IDS_V0)[number];

export const SIMULATOR_UI_QUALITY_POLICY_V0: ClientQualityPolicyV0 = Object.freeze({
  version: "client_quality_policy_v0",
  mode: SIMULATION_MODE,
  environment: SIMULATION_ENVIRONMENT,
  policyId: "cs5-camera-active-only-v0",
  purpose: "capture_ux_only",
  checks: Object.freeze([Object.freeze({ kind: "camera_active" as const })]),
  maxRetakes: 2,
});

export const SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0: Omit<
  SimulationCapturePolicyV0,
  "expiresAt"
> = Object.freeze({
  version: "simulation_capture_policy_v0",
  mode: SIMULATION_MODE,
  environment: SIMULATION_ENVIRONMENT,
  policyId: "cs5-metadata-camera-active-v0",
  dataMode: "metadata_only",
  encoding: "rgba8",
  minFrames: 1,
  maxFrames: 2,
  maxWidth: 1024,
  maxHeight: 1024,
  maxFrameBytes: 4_194_304,
  maxTotalBytes: 8_388_608,
  captureOffsetsAreDiagnosticOnly: true,
  arrayOrderHasBiometricMeaning: false,
  qualityPolicyId: SIMULATOR_UI_QUALITY_POLICY_V0.policyId,
});

export const SIMULATOR_SESSION_STATUS_CODES_V0 = Object.freeze([
  "created",
  "passkey_complete",
  "capture_ready",
  "simulation_pass",
  "simulation_reject",
  "simulation_retry",
  "simulation_unavailable",
  "issuance_rejected",
  "issuance_unavailable",
  "simulated_credential_ready",
  "cancelled",
  "expired",
] as const);

export type SimulatorSessionStatusCodeV0 =
  (typeof SIMULATOR_SESSION_STATUS_CODES_V0)[number];

export const SIMULATOR_BROWSER_SESSION_OPERATIONS_V0 = Object.freeze([
  "bootstrap",
  "create_session",
  "begin_demo_authenticator",
  "complete_demo_authenticator",
  "prepare_capture",
  "submit_capture",
  "retry_unavailable",
  "get_status",
  "cancel",
  "return_to_rp",
] as const);

export type SimulatorBrowserSessionOperationV0 =
  (typeof SIMULATOR_BROWSER_SESSION_OPERATIONS_V0)[number];

export const SIMULATOR_BROWSER_SESSION_ERROR_CODES_V0 = Object.freeze([
  "gateway_disabled",
  "invalid_request",
  "body_too_large",
  "unauthorized",
  "origin_forbidden",
  "not_found",
  "expired",
  "invalid_state",
  "binding_mismatch",
  "replay_rejected",
  "artifact_invalid",
  "resource_busy",
  "network_unavailable",
  "network_timeout",
  "response_invalid",
  "navigation_failed",
  "user_non_completion",
  "demo_authenticator_unavailable",
  "demo_authenticator_interrupted",
] as const);

export type SimulatorBrowserSessionErrorCodeV0 =
  (typeof SIMULATOR_BROWSER_SESSION_ERROR_CODES_V0)[number];

export interface SimulatorUiBootstrapV0 {
  readonly kind: typeof SIMULATOR_UI_BOOTSTRAP_V0;
  readonly version: typeof SIMULATOR_BROWSER_SESSION_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly rpPresentationId: RpPresentationIdV0;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly returnAction: "server_managed";
  readonly authenticator: {
    readonly kind: "injected_demo_only";
    readonly webauthnPerformed: false;
    readonly prfEvaluated: false;
    readonly worldIdCreated: false;
  };
  readonly qualityPolicy: ClientQualityPolicyV0;
}

export interface SimulatorBrowserDemoAuthenticatorReadyV0 {
  readonly kind: typeof SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0;
  readonly version: typeof SIMULATOR_BROWSER_SESSION_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly sessionId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly completionHandle: Identifier;
  readonly claims: {
    readonly webauthnPerformed: false;
    readonly prfEvaluated: false;
    readonly worldIdCreated: false;
  };
  readonly expiresAt: IsoDateTime;
}

export interface SimulatedWorkflowArtifactSummaryV0 {
  readonly kind: typeof SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0;
  readonly biometricVerification: "not_performed";
  readonly uniqueness: "not_performed";
  readonly credentialClass: "not_selfie_check";
  readonly productionCredential: false;
}

export interface SimulatorBrowserSessionViewV0 {
  readonly kind: typeof SIMULATOR_BROWSER_SESSION_VIEW_V0;
  readonly version: typeof SIMULATOR_BROWSER_SESSION_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly sessionId: Identifier;
  readonly browserHandle: Identifier;
  readonly nonceBase64Url: string;
  readonly state: EnrollmentSessionStateV2;
  readonly code: SimulatorSessionStatusCodeV0;
  readonly retryable: boolean;
  readonly expiresAt: IsoDateTime;
  readonly capturePolicy: SimulationCapturePolicyV0;
  readonly artifactSummary: SimulatedWorkflowArtifactSummaryV0 | null;
}

export interface SimulatorBrowserSessionErrorV0 {
  readonly kind: typeof SIMULATOR_BROWSER_SESSION_ERROR_V0;
  readonly version: typeof SIMULATOR_BROWSER_SESSION_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly operation: SimulatorBrowserSessionOperationV0;
  readonly reasonCode: SimulatorBrowserSessionErrorCodeV0;
}

export interface SimulatorBrowserReturnAcceptedV0 {
  readonly kind: typeof SIMULATOR_BROWSER_RETURN_ACCEPTED_V0;
  readonly version: typeof SIMULATOR_BROWSER_SESSION_PORT_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly action: "server_managed";
}

export interface BrowserSessionFieldsV0 {
  readonly sessionId: Identifier;
  readonly browserHandle: Identifier;
}

export interface BrowserIdempotentSessionFieldsV0 extends BrowserSessionFieldsV0 {
  readonly idempotencyKey: Identifier;
}

export interface CreateSimulatorBrowserSessionV0 {
  readonly idempotencyKey: Identifier;
}

export interface CompleteDemoAuthenticatorV0 extends BrowserIdempotentSessionFieldsV0 {
  readonly completionHandle: Identifier;
}

export interface SubmitSimulatorCaptureV0 extends BrowserIdempotentSessionFieldsV0 {
  readonly nonceBase64Url: string;
  readonly frameBundle: FrameBundleV0;
}

export type SimulatorBrowserBootstrapResultV0 =
  | SimulatorUiBootstrapV0
  | SimulatorBrowserSessionErrorV0;
export type SimulatorBrowserDemoAuthenticatorResultV0 =
  | SimulatorBrowserDemoAuthenticatorReadyV0
  | SimulatorBrowserSessionErrorV0;
export type SimulatorBrowserSessionResultV0 =
  | SimulatorBrowserSessionViewV0
  | SimulatorBrowserSessionErrorV0;
export type SimulatorBrowserReturnResultV0 =
  | SimulatorBrowserReturnAcceptedV0
  | SimulatorBrowserSessionErrorV0;

export interface SimulatorBrowserSessionPortV0 {
  bootstrap(): Promise<SimulatorBrowserBootstrapResultV0>;
  createSession(input: CreateSimulatorBrowserSessionV0): Promise<SimulatorBrowserSessionResultV0>;
  beginDemoAuthenticator(input: BrowserIdempotentSessionFieldsV0): Promise<SimulatorBrowserDemoAuthenticatorResultV0>;
  completeDemoAuthenticator(input: CompleteDemoAuthenticatorV0): Promise<SimulatorBrowserSessionResultV0>;
  prepareCapture(input: BrowserSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0>;
  submitCapture(input: SubmitSimulatorCaptureV0): Promise<SimulatorBrowserSessionResultV0>;
  retryUnavailable(input: BrowserIdempotentSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0>;
  getStatus(input: BrowserSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0>;
  cancel(input: BrowserSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0>;
  returnToRp(input: BrowserSessionFieldsV0): Promise<SimulatorBrowserReturnResultV0>;
}

export interface ExpectedSimulatorBrowserSessionViewV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly sessionId: Identifier;
  readonly browserHandle: Identifier;
  readonly now: IsoDateTime;
}

export interface ExpectedSimulatorBrowserDemoAuthenticatorReadyV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly sessionId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly now: IsoDateTime;
}

export interface ExpectedSubmitSimulatorCaptureV0 {
  readonly sessionId: Identifier;
  readonly browserHandle: Identifier;
  readonly idempotencyKey: Identifier;
  readonly nonceBase64Url: string;
  readonly nonceDigestSha256: HexSha256;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly capturePolicy: SimulationCapturePolicyV0;
}

const frozenStatusCodes = (
  ...codes: readonly SimulatorSessionStatusCodeV0[]
): readonly SimulatorSessionStatusCodeV0[] => Object.freeze([...codes]);

const STATE_CODES: Readonly<
  Record<EnrollmentSessionStateV2, readonly SimulatorSessionStatusCodeV0[]>
> = Object.freeze({
  created: frozenStatusCodes("created"),
  passkey_complete: frozenStatusCodes("passkey_complete"),
  capture_ready: frozenStatusCodes("capture_ready"),
  biometric_simulation_pending: frozenStatusCodes("capture_ready"),
  simulated_pass: frozenStatusCodes("simulation_pass"),
  simulated_reject: frozenStatusCodes("simulation_reject"),
  simulated_retry: frozenStatusCodes("simulation_retry"),
  simulated_unavailable: frozenStatusCodes("simulation_unavailable"),
  issuance_simulation_pending: frozenStatusCodes("simulation_pass"),
  simulated_issuance_reject: frozenStatusCodes("issuance_rejected"),
  simulated_issuance_unavailable: frozenStatusCodes("issuance_unavailable"),
  simulated_credential_ready: frozenStatusCodes("simulated_credential_ready"),
  cancelled: frozenStatusCodes("cancelled"),
  expired: frozenStatusCodes("expired"),
});

const RETRYABLE_CODES = new Set<SimulatorSessionStatusCodeV0>([
  "simulation_retry",
  "simulation_unavailable",
  "issuance_unavailable",
]);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAuthenticatorDisclosure(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["kind", "webauthnPerformed", "prfEvaluated", "worldIdCreated"]) &&
    value.kind === "injected_demo_only" &&
    value.webauthnPerformed === false &&
    value.prfEvaluated === false &&
    value.worldIdCreated === false
  );
}

function isNegativeAuthenticatorClaims(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["webauthnPerformed", "prfEvaluated", "worldIdCreated"]) &&
    value.webauthnPerformed === false &&
    value.prfEvaluated === false &&
    value.worldIdCreated === false
  );
}

function isExactUiQualityPolicy(value: unknown): value is ClientQualityPolicyV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, [
        "version",
        "mode",
        "environment",
        "policyId",
        "purpose",
        "checks",
        "maxRetakes",
      ]) &&
      value.version === SIMULATOR_UI_QUALITY_POLICY_V0.version &&
      value.mode === SIMULATOR_UI_QUALITY_POLICY_V0.mode &&
      value.environment === SIMULATOR_UI_QUALITY_POLICY_V0.environment &&
      value.policyId === SIMULATOR_UI_QUALITY_POLICY_V0.policyId &&
      value.purpose === SIMULATOR_UI_QUALITY_POLICY_V0.purpose &&
      value.maxRetakes === SIMULATOR_UI_QUALITY_POLICY_V0.maxRetakes &&
      Array.isArray(value.checks) &&
      value.checks.length === 1 &&
      isRecord(value.checks[0]) &&
      hasExactKeys(value.checks[0], ["kind"]) &&
      value.checks[0].kind === "camera_active" &&
      validateClientQualityPolicyV0(
        value as unknown as ClientQualityPolicyV0,
      ).length === 0
    );
  } catch {
    return false;
  }
}

function isExactUiCapturePolicy(value: unknown): value is SimulationCapturePolicyV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, [
        "version",
        "mode",
        "environment",
        "policyId",
        "dataMode",
        "encoding",
        "minFrames",
        "maxFrames",
        "maxWidth",
        "maxHeight",
        "maxFrameBytes",
        "maxTotalBytes",
        "captureOffsetsAreDiagnosticOnly",
        "arrayOrderHasBiometricMeaning",
        "qualityPolicyId",
        "expiresAt",
      ]) &&
      value.version === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.version &&
      value.mode === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.mode &&
      value.environment === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.environment &&
      value.policyId === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.policyId &&
      value.dataMode === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.dataMode &&
      value.encoding === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.encoding &&
      value.minFrames === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.minFrames &&
      value.maxFrames === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.maxFrames &&
      value.maxWidth === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.maxWidth &&
      value.maxHeight === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.maxHeight &&
      value.maxFrameBytes === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.maxFrameBytes &&
      value.maxTotalBytes === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.maxTotalBytes &&
      value.captureOffsetsAreDiagnosticOnly === true &&
      value.arrayOrderHasBiometricMeaning === false &&
      value.qualityPolicyId === SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.qualityPolicyId &&
      isIsoDateTime(value.expiresAt) &&
      validateSimulationCapturePolicyV0(
        value as unknown as SimulationCapturePolicyV0,
      ).length === 0
    );
  } catch {
    return false;
  }
}

export function isCreateSimulatorBrowserSessionV0(
  value: unknown,
): value is CreateSimulatorBrowserSessionV0 {
  try {
    return isRecord(value) && hasExactKeys(value, ["idempotencyKey"]) && nonEmpty(value.idempotencyKey);
  } catch {
    return false;
  }
}

export function isBrowserSessionFieldsV0(value: unknown): value is BrowserSessionFieldsV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, ["sessionId", "browserHandle"]) &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.browserHandle)
    );
  } catch {
    return false;
  }
}

export function isBrowserIdempotentSessionFieldsV0(
  value: unknown,
): value is BrowserIdempotentSessionFieldsV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, ["sessionId", "browserHandle", "idempotencyKey"]) &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.browserHandle) &&
      nonEmpty(value.idempotencyKey)
    );
  } catch {
    return false;
  }
}

export function isCompleteDemoAuthenticatorV0(
  value: unknown,
): value is CompleteDemoAuthenticatorV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, ["sessionId", "browserHandle", "idempotencyKey", "completionHandle"]) &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.browserHandle) &&
      nonEmpty(value.idempotencyKey) &&
      nonEmpty(value.completionHandle)
    );
  } catch {
    return false;
  }
}

export function isSubmitSimulatorCaptureShapeV0(
  value: unknown,
): value is SubmitSimulatorCaptureV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, [
        "sessionId",
        "browserHandle",
        "idempotencyKey",
        "nonceBase64Url",
        "frameBundle",
      ]) &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.browserHandle) &&
      nonEmpty(value.idempotencyKey) &&
      nonEmpty(value.nonceBase64Url) &&
      isRecord(value.frameBundle)
    );
  } catch {
    return false;
  }
}

export async function matchesExpectedSubmitSimulatorCaptureV0(
  value: unknown,
  expected: ExpectedSubmitSimulatorCaptureV0,
): Promise<boolean> {
  try {
    if (
      !isSubmitSimulatorCaptureShapeV0(value) ||
      !isExactUiCapturePolicy(expected.capturePolicy)
    ) {
      return false;
    }
    const bundle = value.frameBundle;
    return (
      value.sessionId === expected.sessionId &&
      value.browserHandle === expected.browserHandle &&
      value.idempotencyKey === expected.idempotencyKey &&
      value.nonceBase64Url === expected.nonceBase64Url &&
      bundle.sessionId === expected.sessionId &&
      bundle.nonceDigestSha256 === expected.nonceDigestSha256 &&
      bundle.accountPublicMaterialDigestSha256 === expected.accountPublicMaterialDigestSha256 &&
      (await validateFrameBundleV0(bundle, expected.capturePolicy)).length === 0
    );
  } catch {
    return false;
  }
}

export function isSimulatorUiBootstrapV0(value: unknown): value is SimulatorUiBootstrapV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, [
        "kind",
        "version",
        "mode",
        "environment",
        "rpPresentationId",
        "accountPublicMaterialDigestSha256",
        "returnAction",
        "authenticator",
        "qualityPolicy",
      ]) &&
      value.kind === SIMULATOR_UI_BOOTSTRAP_V0 &&
      value.version === SIMULATOR_BROWSER_SESSION_PORT_V0 &&
      value.mode === SIMULATION_MODE &&
      value.environment === SIMULATION_ENVIRONMENT &&
      typeof value.rpPresentationId === "string" &&
      RP_PRESENTATION_IDS_V0.includes(value.rpPresentationId as RpPresentationIdV0) &&
      isHexSha256(value.accountPublicMaterialDigestSha256) &&
      value.returnAction === "server_managed" &&
      isAuthenticatorDisclosure(value.authenticator) &&
      isExactUiQualityPolicy(value.qualityPolicy)
    );
  } catch {
    return false;
  }
}

export function isSimulatorBrowserDemoAuthenticatorReadyV0(
  value: unknown,
): value is SimulatorBrowserDemoAuthenticatorReadyV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, [
        "kind",
        "version",
        "mode",
        "environment",
        "sessionId",
        "idempotencyKey",
        "completionHandle",
        "claims",
        "expiresAt",
      ]) &&
      value.kind === SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0 &&
      value.version === SIMULATOR_BROWSER_SESSION_PORT_V0 &&
      value.mode === SIMULATION_MODE &&
      value.environment === SIMULATION_ENVIRONMENT &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.idempotencyKey) &&
      nonEmpty(value.completionHandle) &&
      isNegativeAuthenticatorClaims(value.claims) &&
      isIsoDateTime(value.expiresAt)
    );
  } catch {
    return false;
  }
}

export function matchesExpectedSimulatorBrowserDemoAuthenticatorReadyV0(
  value: unknown,
  expected: ExpectedSimulatorBrowserDemoAuthenticatorReadyV0,
): value is SimulatorBrowserDemoAuthenticatorReadyV0 {
  assertSimulationArtifactAllowed(expected.runtimeEnvironment, value);
  try {
    return (
      isIsoDateTime(expected.now) &&
      isSimulatorBrowserDemoAuthenticatorReadyV0(value) &&
      value.sessionId === expected.sessionId &&
      value.idempotencyKey === expected.idempotencyKey &&
      Date.parse(value.expiresAt) > Date.parse(expected.now)
    );
  } catch {
    return false;
  }
}

export function isSimulatedWorkflowArtifactSummaryV0(
  value: unknown,
): value is SimulatedWorkflowArtifactSummaryV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, [
        "kind",
        "biometricVerification",
        "uniqueness",
        "credentialClass",
        "productionCredential",
      ]) &&
      value.kind === SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0 &&
      value.biometricVerification === "not_performed" &&
      value.uniqueness === "not_performed" &&
      value.credentialClass === "not_selfie_check" &&
      value.productionCredential === false
    );
  } catch {
    return false;
  }
}

export function isSimulatorBrowserSessionErrorV0(
  value: unknown,
): value is SimulatorBrowserSessionErrorV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, ["kind", "version", "mode", "environment", "operation", "reasonCode"]) &&
      value.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0 &&
      value.version === SIMULATOR_BROWSER_SESSION_PORT_V0 &&
      value.mode === SIMULATION_MODE &&
      value.environment === SIMULATION_ENVIRONMENT &&
      typeof value.operation === "string" &&
      SIMULATOR_BROWSER_SESSION_OPERATIONS_V0.includes(
        value.operation as SimulatorBrowserSessionOperationV0,
      ) &&
      typeof value.reasonCode === "string" &&
      SIMULATOR_BROWSER_SESSION_ERROR_CODES_V0.includes(
        value.reasonCode as SimulatorBrowserSessionErrorCodeV0,
      )
    );
  } catch {
    return false;
  }
}

export function isSimulatorBrowserReturnAcceptedV0(
  value: unknown,
): value is SimulatorBrowserReturnAcceptedV0 {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, ["kind", "version", "mode", "environment", "action"]) &&
      value.kind === SIMULATOR_BROWSER_RETURN_ACCEPTED_V0 &&
      value.version === SIMULATOR_BROWSER_SESSION_PORT_V0 &&
      value.mode === SIMULATION_MODE &&
      value.environment === SIMULATION_ENVIRONMENT &&
      value.action === "server_managed"
    );
  } catch {
    return false;
  }
}

export function isSimulatorBrowserSessionViewV0(
  value: unknown,
): value is SimulatorBrowserSessionViewV0 {
  try {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        "kind",
        "version",
        "mode",
        "environment",
        "sessionId",
        "browserHandle",
        "nonceBase64Url",
        "state",
        "code",
        "retryable",
        "expiresAt",
        "capturePolicy",
        "artifactSummary",
      ]) ||
      value.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0 ||
      value.version !== SIMULATOR_BROWSER_SESSION_PORT_V0 ||
      value.mode !== SIMULATION_MODE ||
      value.environment !== SIMULATION_ENVIRONMENT ||
      !nonEmpty(value.sessionId) ||
      !nonEmpty(value.browserHandle) ||
      !nonEmpty(value.nonceBase64Url) ||
      typeof value.state !== "string" ||
      !ENROLLMENT_SESSION_STATES_V2.includes(value.state as EnrollmentSessionStateV2) ||
      typeof value.code !== "string" ||
      !SIMULATOR_SESSION_STATUS_CODES_V0.includes(value.code as SimulatorSessionStatusCodeV0) ||
      typeof value.retryable !== "boolean" ||
      !isIsoDateTime(value.expiresAt) ||
      !isExactUiCapturePolicy(value.capturePolicy) ||
      value.capturePolicy.expiresAt !== value.expiresAt
    ) {
      return false;
    }
    const state = value.state as EnrollmentSessionStateV2;
    const code = value.code as SimulatorSessionStatusCodeV0;
    const summaryValid =
      value.artifactSummary === null ||
      isSimulatedWorkflowArtifactSummaryV0(value.artifactSummary);
    return (
      STATE_CODES[state].includes(code) &&
      value.retryable === RETRYABLE_CODES.has(code) &&
      summaryValid &&
      (state === "simulated_credential_ready"
        ? value.artifactSummary !== null
        : value.artifactSummary === null)
    );
  } catch {
    return false;
  }
}

export function matchesExpectedSimulatorBrowserSessionViewV0(
  value: unknown,
  expected: ExpectedSimulatorBrowserSessionViewV0,
): value is SimulatorBrowserSessionViewV0 {
  assertSimulationArtifactAllowed(expected.runtimeEnvironment, value);
  try {
    return (
      isIsoDateTime(expected.now) &&
      isSimulatorBrowserSessionViewV0(value) &&
      value.sessionId === expected.sessionId &&
      value.browserHandle === expected.browserHandle &&
      Date.parse(value.expiresAt) > Date.parse(expected.now)
    );
  } catch {
    return false;
  }
}

export function assertSimulatorBrowserArtifactAllowed(
  runtimeEnvironment: RuntimeEnvironment,
  value: unknown,
): void {
  assertSimulationArtifactAllowed(runtimeEnvironment, value);
}

// The browser projection intentionally omits simulator scenarios, receipts,
// signatures, credential bodies, account identifiers, and return URLs. The
// opaque browser/completion handles remain transient effect-runner state only.
