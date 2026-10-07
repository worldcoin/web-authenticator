import type { EnrollmentSessionStateV2 } from "./enrollment-session-v2";
import { ENROLLMENT_SESSION_STATES_V2 } from "./enrollment-session-v2";
import type { RuntimeEnvironment } from "./common";
import {
  assertSimulationArtifactAllowed,
  hasExactKeys,
  isRecord,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
} from "./common";
import {
  RP_PRESENTATION_IDS_V0,
  isSimulatorBrowserSessionErrorV0,
  type RpPresentationIdV0,
  type SimulatorBrowserSessionErrorV0,
} from "./simulator-browser-session-port-v0";

export const AUTHENTICATOR_UI_FLOW_V1 = "authenticator_ui_flow_v1" as const;
export const AUTHENTICATOR_UI_SNAPSHOT_V1 = "authenticator_ui_snapshot_v1" as const;

export const AUTHENTICATOR_UI_STATES_V1 = Object.freeze([
  "request_checking",
  "request_review",
  "request_invalid",
  "request_expired",
  "request_return_target_invalid",
  "request_rp_identity_unavailable",
  "admission_checking",
  "admission_safari_candidate",
  "admission_chrome_candidate",
  "admission_handoff_required",
  "admission_handoff_departing",
  "admission_handoff_failed",
  "admission_update_required",
  "admission_unsupported",
  "admission_insecure",
  "admission_framed",
  "admission_private",
  "admission_pwa",
  "admission_unknown",
  "demo_authenticator_intro",
  "session_creating",
  "demo_authenticator_pending",
  "session_completing_authenticator",
  "demo_authenticator_ready",
  "demo_authenticator_non_completion",
  "demo_authenticator_unavailable",
  "demo_authenticator_interrupted",
  "demo_authenticator_transport_failure",
  "demo_authenticator_invalid_response",
  "session_reconciling",
  "session_error",
  "capture_policy_loading",
  "capture_intro",
  "capture_permission_request",
  "capture_acquiring",
  "capture_preparing",
  "capture_preview",
  "capture_guidance_adjust",
  "capture_guidance_retake",
  "capture_guidance_unavailable",
  "capture_sampling",
  "capture_artifact_ready",
  "capture_cleaning",
  "capture_complete",
  "capture_error",
  "biometric_simulation_pending",
  "biometric_simulated_pass",
  "biometric_simulated_reject",
  "biometric_simulated_retry",
  "biometric_simulated_unavailable",
  "issuance_simulation_pending",
  "issuance_simulated_reject",
  "issuance_simulated_unavailable",
  "simulated_credential_ready",
  "return_redirecting",
  "return_callback_failed",
  "returned",
  "flow_cancelling",
  "flow_cancelled",
  "flow_closed",
  "flow_expired",
  "flow_failed",
] as const);

export type AuthenticatorUiStateIdV1 = (typeof AUTHENTICATOR_UI_STATES_V1)[number];

export const AUTHENTICATOR_UI_PROGRESS_STAGES_V1 = Object.freeze([
  "request_validation",
  "admission",
  "demo_authenticator",
  "session_create",
  "camera_permission",
  "camera_prepare",
  "frame_collection",
  "biometric_simulation",
  "issuance_simulation",
  "status_recovery",
  "callback",
  "cancellation",
] as const);

export type AuthenticatorUiProgressStageV1 =
  (typeof AUTHENTICATOR_UI_PROGRESS_STAGES_V1)[number];
export type AuthenticatorUiProgressStatusV1 = "idle" | "pending" | "complete";

export interface AuthenticatorUiProgressV1 {
  readonly stage: AuthenticatorUiProgressStageV1;
  readonly status: AuthenticatorUiProgressStatusV1;
}

export const AUTHENTICATOR_UI_DETAIL_CODES_V1 = Object.freeze([
  "face_not_found",
  "multiple_faces",
  "move_closer",
  "move_farther",
  "center_face",
  "improve_lighting",
  "reduce_lighting",
  "image_blurry",
  "camera_inactive",
  "camera_unavailable",
  "face_guidance_unavailable",
  "framing_guidance_unavailable",
  "lighting_guidance_unavailable",
  "sharpness_guidance_unavailable",
  "retake_limit_reached",
  "policy_invalid",
  "quality_input_invalid",
  "unsupported_context",
  "prf_not_ready",
  "user_activation_required",
  "permission_denied",
  "camera_busy",
  "camera_restricted",
  "camera_unsupported",
  "non_user_facing_camera",
  "constraints_unsatisfied",
  "acquisition_aborted",
  "permission_timeout",
  "preview_timeout",
  "preview_invalid_frame",
  "interrupted",
  "session_expired",
  "capture_in_progress",
  "artifact_limit",
  "quality_callback_failed",
  "unknown",
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
  "return_target_invalid",
  "navigation_blocked",
  "navigation_failed",
  "safe_internal_error",
] as const);

export type AuthenticatorUiDetailCodeV1 =
  (typeof AUTHENTICATOR_UI_DETAIL_CODES_V1)[number];

export const AUTHENTICATOR_UI_VISUAL_SOURCES_V1 = Object.freeze([
  "figma_5132_134352",
  "figma_5132_134394",
  "figma_5132_134441",
  "figma_5132_134488",
  "figma_5132_134535",
  "figma_5132_134582_external",
  "figma_5132_134643",
  "figma_5132_134692_external",
  "figma_5132_134743",
  "figma_5132_134841",
  "figma_5132_134939",
  "figma_5132_135038",
  "figma_5132_135071",
  "figma_5132_135104",
  "verified_template",
  "not_figma_verified",
  "none",
] as const);

export type AuthenticatorUiVisualSourceV1 =
  (typeof AUTHENTICATOR_UI_VISUAL_SOURCES_V1)[number];

export interface AuthenticatorUiSnapshotV1 {
  readonly kind: typeof AUTHENTICATOR_UI_SNAPSHOT_V1;
  readonly version: typeof AUTHENTICATOR_UI_FLOW_V1;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly state: AuthenticatorUiStateIdV1;
  readonly progress: AuthenticatorUiProgressV1;
  readonly detailCode: AuthenticatorUiDetailCodeV1 | null;
  readonly authoritativeSessionState: EnrollmentSessionStateV2 | null;
  readonly rpPresentationId: RpPresentationIdV0 | null;
  readonly visualSource: AuthenticatorUiVisualSourceV1;
}

export const AUTHENTICATOR_UI_STATE_PROGRESS_V1: Readonly<
  Record<AuthenticatorUiStateIdV1, AuthenticatorUiProgressV1>
> = {
  request_checking: { stage: "request_validation", status: "pending" },
  request_review: { stage: "request_validation", status: "complete" },
  request_invalid: { stage: "request_validation", status: "complete" },
  request_expired: { stage: "request_validation", status: "complete" },
  request_return_target_invalid: { stage: "request_validation", status: "complete" },
  request_rp_identity_unavailable: { stage: "request_validation", status: "complete" },
  admission_checking: { stage: "admission", status: "pending" },
  admission_safari_candidate: { stage: "admission", status: "complete" },
  admission_chrome_candidate: { stage: "admission", status: "complete" },
  admission_handoff_required: { stage: "admission", status: "complete" },
  admission_handoff_departing: { stage: "admission", status: "pending" },
  admission_handoff_failed: { stage: "admission", status: "complete" },
  admission_update_required: { stage: "admission", status: "complete" },
  admission_unsupported: { stage: "admission", status: "complete" },
  admission_insecure: { stage: "admission", status: "complete" },
  admission_framed: { stage: "admission", status: "complete" },
  admission_private: { stage: "admission", status: "complete" },
  admission_pwa: { stage: "admission", status: "complete" },
  admission_unknown: { stage: "admission", status: "complete" },
  demo_authenticator_intro: { stage: "demo_authenticator", status: "idle" },
  session_creating: { stage: "session_create", status: "pending" },
  demo_authenticator_pending: { stage: "demo_authenticator", status: "pending" },
  session_completing_authenticator: { stage: "demo_authenticator", status: "pending" },
  demo_authenticator_ready: { stage: "demo_authenticator", status: "complete" },
  demo_authenticator_non_completion: { stage: "demo_authenticator", status: "complete" },
  demo_authenticator_unavailable: { stage: "demo_authenticator", status: "complete" },
  demo_authenticator_interrupted: { stage: "demo_authenticator", status: "complete" },
  demo_authenticator_transport_failure: { stage: "demo_authenticator", status: "complete" },
  demo_authenticator_invalid_response: { stage: "demo_authenticator", status: "complete" },
  session_reconciling: { stage: "status_recovery", status: "pending" },
  session_error: { stage: "status_recovery", status: "complete" },
  capture_policy_loading: { stage: "camera_prepare", status: "pending" },
  capture_intro: { stage: "camera_prepare", status: "complete" },
  capture_permission_request: { stage: "camera_permission", status: "pending" },
  capture_acquiring: { stage: "camera_prepare", status: "pending" },
  capture_preparing: { stage: "camera_prepare", status: "pending" },
  capture_preview: { stage: "camera_prepare", status: "complete" },
  capture_guidance_adjust: { stage: "camera_prepare", status: "complete" },
  capture_guidance_retake: { stage: "frame_collection", status: "complete" },
  capture_guidance_unavailable: { stage: "camera_prepare", status: "complete" },
  capture_sampling: { stage: "frame_collection", status: "pending" },
  capture_artifact_ready: { stage: "frame_collection", status: "complete" },
  capture_cleaning: { stage: "frame_collection", status: "pending" },
  capture_complete: { stage: "frame_collection", status: "complete" },
  capture_error: { stage: "frame_collection", status: "complete" },
  biometric_simulation_pending: { stage: "biometric_simulation", status: "pending" },
  biometric_simulated_pass: { stage: "biometric_simulation", status: "complete" },
  biometric_simulated_reject: { stage: "biometric_simulation", status: "complete" },
  biometric_simulated_retry: { stage: "biometric_simulation", status: "complete" },
  biometric_simulated_unavailable: { stage: "biometric_simulation", status: "complete" },
  issuance_simulation_pending: { stage: "issuance_simulation", status: "pending" },
  issuance_simulated_reject: { stage: "issuance_simulation", status: "complete" },
  issuance_simulated_unavailable: { stage: "issuance_simulation", status: "complete" },
  simulated_credential_ready: { stage: "issuance_simulation", status: "complete" },
  return_redirecting: { stage: "callback", status: "pending" },
  return_callback_failed: { stage: "callback", status: "complete" },
  returned: { stage: "callback", status: "complete" },
  flow_cancelling: { stage: "cancellation", status: "pending" },
  flow_cancelled: { stage: "cancellation", status: "complete" },
  flow_closed: { stage: "cancellation", status: "complete" },
  flow_expired: { stage: "cancellation", status: "complete" },
  flow_failed: { stage: "cancellation", status: "complete" },
};

for (const progress of Object.values(AUTHENTICATOR_UI_STATE_PROGRESS_V1)) {
  Object.freeze(progress);
}
Object.freeze(AUTHENTICATOR_UI_STATE_PROGRESS_V1);

const ADJUST_CODES = new Set<AuthenticatorUiDetailCodeV1>([
  "face_not_found",
  "multiple_faces",
  "move_closer",
  "move_farther",
  "center_face",
  "improve_lighting",
  "reduce_lighting",
]);

const UNAVAILABLE_GUIDANCE_CODES = new Set<AuthenticatorUiDetailCodeV1>([
  "camera_inactive",
  "camera_unavailable",
  "face_guidance_unavailable",
  "framing_guidance_unavailable",
  "lighting_guidance_unavailable",
  "sharpness_guidance_unavailable",
  "retake_limit_reached",
  "policy_invalid",
  "quality_input_invalid",
]);

const CAPTURE_ERROR_CODES = new Set<AuthenticatorUiDetailCodeV1>([
  "unsupported_context",
  "prf_not_ready",
  "user_activation_required",
  "permission_denied",
  "camera_unavailable",
  "camera_busy",
  "camera_restricted",
  "camera_unsupported",
  "non_user_facing_camera",
  "constraints_unsatisfied",
  "acquisition_aborted",
  "permission_timeout",
  "preview_timeout",
  "preview_invalid_frame",
  "interrupted",
  "session_expired",
  "capture_in_progress",
  "artifact_limit",
  "quality_callback_failed",
  "unknown",
]);

const SESSION_ERROR_CODES = new Set<AuthenticatorUiDetailCodeV1>([
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
]);

const CALLBACK_ERROR_CODES = new Set<AuthenticatorUiDetailCodeV1>([
  "return_target_invalid",
  "navigation_blocked",
  "navigation_failed",
]);

function detailMatchesState(
  state: AuthenticatorUiStateIdV1,
  detailCode: AuthenticatorUiDetailCodeV1 | null,
): boolean {
  if (state === "capture_guidance_adjust") return detailCode !== null && ADJUST_CODES.has(detailCode);
  if (state === "capture_guidance_retake") return detailCode === "image_blurry";
  if (state === "capture_guidance_unavailable") {
    return detailCode !== null && UNAVAILABLE_GUIDANCE_CODES.has(detailCode);
  }
  if (state === "capture_error") return detailCode !== null && CAPTURE_ERROR_CODES.has(detailCode);
  if (state === "session_error") return detailCode !== null && SESSION_ERROR_CODES.has(detailCode);
  if (state === "return_callback_failed") {
    return detailCode !== null && CALLBACK_ERROR_CODES.has(detailCode);
  }
  if (state === "flow_failed") return detailCode === "safe_internal_error";
  return detailCode === null;
}

export const ENROLLMENT_SESSION_TO_UI_STATE_V1: Readonly<
  Record<EnrollmentSessionStateV2, AuthenticatorUiStateIdV1>
> = Object.freeze({
  created: "demo_authenticator_pending",
  passkey_complete: "demo_authenticator_ready",
  capture_ready: "capture_intro",
  biometric_simulation_pending: "biometric_simulation_pending",
  simulated_pass: "biometric_simulated_pass",
  simulated_reject: "biometric_simulated_reject",
  simulated_retry: "biometric_simulated_retry",
  simulated_unavailable: "biometric_simulated_unavailable",
  issuance_simulation_pending: "issuance_simulation_pending",
  simulated_issuance_reject: "issuance_simulated_reject",
  simulated_issuance_unavailable: "issuance_simulated_unavailable",
  simulated_credential_ready: "simulated_credential_ready",
  cancelled: "flow_cancelled",
  expired: "flow_expired",
});

const frozenUiStates = (
  ...states: readonly AuthenticatorUiStateIdV1[]
): readonly AuthenticatorUiStateIdV1[] => Object.freeze([...states]);

export const ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1: Readonly<
  Record<EnrollmentSessionStateV2, readonly AuthenticatorUiStateIdV1[]>
> = Object.freeze({
  created: frozenUiStates(
    "demo_authenticator_pending",
    "session_completing_authenticator",
    "demo_authenticator_non_completion",
    "demo_authenticator_unavailable",
    "demo_authenticator_interrupted",
    "demo_authenticator_transport_failure",
    "demo_authenticator_invalid_response",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  passkey_complete: frozenUiStates(
    "demo_authenticator_ready",
    "capture_policy_loading",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  capture_ready: frozenUiStates(
    "capture_intro",
    "capture_permission_request",
    "capture_acquiring",
    "capture_preparing",
    "capture_preview",
    "capture_guidance_adjust",
    "capture_guidance_retake",
    "capture_guidance_unavailable",
    "capture_sampling",
    "capture_artifact_ready",
    "capture_cleaning",
    "capture_complete",
    "capture_error",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  biometric_simulation_pending: frozenUiStates(
    "biometric_simulation_pending",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  simulated_pass: frozenUiStates(
    "biometric_simulated_pass",
    "issuance_simulation_pending",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  simulated_reject: frozenUiStates(
    "biometric_simulated_reject",
  ),
  simulated_retry: frozenUiStates(
    "biometric_simulated_retry",
    "capture_policy_loading",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  simulated_unavailable: frozenUiStates(
    "biometric_simulated_unavailable",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  issuance_simulation_pending: frozenUiStates(
    "issuance_simulation_pending",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  simulated_issuance_reject: frozenUiStates(
    "issuance_simulated_reject",
  ),
  simulated_issuance_unavailable: frozenUiStates(
    "issuance_simulated_unavailable",
    "session_reconciling",
    "session_error",
    "flow_cancelling",
  ),
  simulated_credential_ready: frozenUiStates(
    "simulated_credential_ready",
  ),
  cancelled: frozenUiStates("flow_cancelled"),
  expired: frozenUiStates("flow_expired"),
});

const SERVER_STATE_REQUIRED_UI_STATES = new Set<AuthenticatorUiStateIdV1>([
  "demo_authenticator_pending",
  "session_completing_authenticator",
  "demo_authenticator_ready",
  "demo_authenticator_non_completion",
  "demo_authenticator_unavailable",
  "demo_authenticator_interrupted",
  "demo_authenticator_transport_failure",
  "demo_authenticator_invalid_response",
  "capture_policy_loading",
  "capture_intro",
  "capture_permission_request",
  "capture_acquiring",
  "capture_preparing",
  "capture_preview",
  "capture_guidance_adjust",
  "capture_guidance_retake",
  "capture_guidance_unavailable",
  "capture_sampling",
  "capture_artifact_ready",
  "capture_cleaning",
  "capture_complete",
  "capture_error",
  "biometric_simulation_pending",
  "biometric_simulated_pass",
  "biometric_simulated_reject",
  "biometric_simulated_retry",
  "biometric_simulated_unavailable",
  "issuance_simulation_pending",
  "issuance_simulated_reject",
  "issuance_simulated_unavailable",
  "simulated_credential_ready",
  "session_error",
]);

function authoritativeStateMatchesUi(
  state: AuthenticatorUiStateIdV1,
  authoritativeSessionState: EnrollmentSessionStateV2 | null,
): boolean {
  if (authoritativeSessionState === null) return !SERVER_STATE_REQUIRED_UI_STATES.has(state);
  return ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1[authoritativeSessionState].includes(state);
}

export const AUTHENTICATOR_UI_TERMINAL_STATES_V1 = Object.freeze([
  "request_invalid",
  "request_expired",
  "request_return_target_invalid",
  "request_rp_identity_unavailable",
  "admission_update_required",
  "admission_unsupported",
  "admission_insecure",
  "admission_framed",
  "admission_private",
  "admission_pwa",
  "admission_unknown",
  "biometric_simulated_reject",
  "issuance_simulated_reject",
  "simulated_credential_ready",
  "returned",
  "flow_cancelled",
  "flow_closed",
  "flow_expired",
  "flow_failed",
] as const satisfies readonly AuthenticatorUiStateIdV1[]);

const TERMINAL_STATE_SET = new Set<AuthenticatorUiStateIdV1>(
  AUTHENTICATOR_UI_TERMINAL_STATES_V1,
);

export const AUTHENTICATOR_UI_ACTIONS_V1 = Object.freeze([
  "continue",
  "cancel",
  "open_external_browser",
  "start_demo_authenticator",
  "continue_to_camera",
  "start_camera",
  "collect_frame_metadata",
  "try_again",
  "continue_without_guidance",
  "retake",
  "retry_same_operation",
  "query_status",
  "return_to_rp",
  "close",
] as const);

export type AuthenticatorUiActionV1 = (typeof AUTHENTICATOR_UI_ACTIONS_V1)[number];

export const AUTHENTICATOR_UI_EFFECTS_V1 = Object.freeze([
  "validate_request",
  "evaluate_admission",
  "open_external_browser",
  "create_session",
  "begin_demo_authenticator",
  "complete_demo_authenticator",
  "prepare_capture",
  "start_capture",
  "evaluate_quality",
  "collect_frame_metadata",
  "stop_capture",
  "clear_transient_media",
  "abort_active_effects",
  "submit_capture",
  "retry_unavailable",
  "query_status",
  "cancel_session",
  "return_to_rp",
  "close_locally",
] as const);

export type AuthenticatorUiEffectV1 = (typeof AUTHENTICATOR_UI_EFFECTS_V1)[number];

export const AUTHENTICATOR_UI_INITIAL_EFFECTS_V1 = Object.freeze([
  "validate_request",
] as const satisfies readonly AuthenticatorUiEffectV1[]);

export const AUTHENTICATOR_UI_EVENTS_V1 = Object.freeze([
  "request_accepted",
  "request_invalid",
  "request_expired",
  "request_return_target_invalid",
  "request_rp_identity_unavailable",
  "continue",
  "admission_safari_candidate",
  "admission_chrome_candidate",
  "admission_handoff_required",
  "admission_update_required",
  "admission_unsupported",
  "admission_insecure",
  "admission_framed",
  "admission_private",
  "admission_pwa",
  "admission_unknown",
  "handoff_started",
  "handoff_failed",
  "start_demo_authenticator",
  "demo_authenticator_ready",
  "demo_authenticator_non_completion",
  "demo_authenticator_unavailable",
  "demo_authenticator_interrupted",
  "demo_authenticator_transport_failure",
  "demo_authenticator_invalid_response",
  "continue_to_camera",
  "start_camera",
  "capture_permission_requested",
  "capture_acquiring",
  "capture_preparing",
  "capture_preview",
  "quality_ready",
  "quality_adjust",
  "quality_retake",
  "quality_unavailable",
  "capture_sampling",
  "capture_artifact_ready",
  "cleanup_started",
  "cleanup_complete",
  "capture_failed",
  "authoritative_session",
  "session_failed",
  "try_again",
  "continue_without_guidance",
  "retake",
  "retry_requested",
  "status_requested",
  "cancel_requested",
  "local_cancel_complete",
  "local_close_requested",
  "page_hidden",
  "page_unloaded",
  "orientation_invalidated",
  "component_unmounted",
  "operation_interrupted",
  "session_expired",
  "return_requested",
  "return_failed",
  "return_completed",
  "fatal_error",
] as const);

export type AuthenticatorUiEventTypeV1 = (typeof AUTHENTICATOR_UI_EVENTS_V1)[number];
export const AUTHENTICATOR_UI_EVENT_V1 = "authenticator_ui_event_v1" as const;

export interface AuthenticatorUiEventV1 {
  readonly kind: typeof AUTHENTICATOR_UI_EVENT_V1;
  readonly version: typeof AUTHENTICATOR_UI_FLOW_V1;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly event: AuthenticatorUiEventTypeV1;
  readonly detailCode: AuthenticatorUiDetailCodeV1 | null;
  readonly authoritativeSessionState: EnrollmentSessionStateV2 | null;
  readonly rpPresentationId: RpPresentationIdV0 | null;
}

export interface AuthenticatorUiTransitionV1 {
  readonly snapshot: AuthenticatorUiSnapshotV1;
  readonly effects: readonly AuthenticatorUiEffectV1[];
}

function frozenList<T>(...values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

const EMPTY_ACTIONS = frozenList<AuthenticatorUiActionV1>();
const actionMap = Object.fromEntries(
  AUTHENTICATOR_UI_STATES_V1.map((state) => [state, EMPTY_ACTIONS]),
) as Record<AuthenticatorUiStateIdV1, readonly AuthenticatorUiActionV1[]>;

actionMap.request_review = frozenList("continue", "cancel");
actionMap.admission_safari_candidate = frozenList("continue", "cancel");
actionMap.admission_chrome_candidate = frozenList("continue", "cancel");
actionMap.admission_handoff_required = frozenList("open_external_browser", "cancel");
actionMap.demo_authenticator_intro = frozenList("start_demo_authenticator", "cancel");
actionMap.demo_authenticator_ready = frozenList("continue_to_camera", "cancel");
actionMap.demo_authenticator_non_completion = frozenList("try_again", "cancel");
actionMap.demo_authenticator_interrupted = frozenList("try_again", "cancel");
actionMap.demo_authenticator_transport_failure = frozenList("query_status", "cancel");
actionMap.capture_intro = frozenList("start_camera", "cancel");
actionMap.capture_preview = frozenList("collect_frame_metadata", "cancel");
actionMap.capture_guidance_adjust = frozenList("try_again", "cancel");
actionMap.capture_guidance_retake = frozenList("retake", "cancel");
actionMap.capture_guidance_unavailable = frozenList("continue_without_guidance", "cancel");
actionMap.capture_error = frozenList("try_again", "cancel");
actionMap.biometric_simulated_retry = frozenList("retake", "cancel");
actionMap.biometric_simulated_unavailable = frozenList(
  "retry_same_operation",
  "query_status",
  "cancel",
);
actionMap.issuance_simulated_unavailable = frozenList(
  "retry_same_operation",
  "query_status",
  "cancel",
);
actionMap.session_error = frozenList("query_status", "cancel");
actionMap.return_callback_failed = frozenList("return_to_rp", "close");

for (const state of [
  "request_invalid",
  "request_expired",
  "request_return_target_invalid",
  "request_rp_identity_unavailable",
  "admission_handoff_failed",
  "admission_update_required",
  "admission_unsupported",
  "admission_insecure",
  "admission_framed",
  "admission_private",
  "admission_pwa",
  "admission_unknown",
  "flow_cancelled",
  "flow_expired",
  "flow_failed",
] as const) {
  actionMap[state] = frozenList("close");
}

for (const state of [
  "demo_authenticator_unavailable",
  "demo_authenticator_invalid_response",
  "biometric_simulated_reject",
  "issuance_simulated_reject",
  "simulated_credential_ready",
] as const) {
  actionMap[state] = frozenList("return_to_rp");
}

for (const state of [
  "request_checking",
  "admission_checking",
  "admission_handoff_departing",
  "session_creating",
  "demo_authenticator_pending",
  "session_completing_authenticator",
  "session_reconciling",
  "capture_policy_loading",
  "capture_permission_request",
  "capture_acquiring",
  "capture_preparing",
  "capture_sampling",
  "capture_artifact_ready",
  "capture_cleaning",
  "capture_complete",
  "biometric_simulation_pending",
  "biometric_simulated_pass",
  "issuance_simulation_pending",
  "return_redirecting",
] as const) {
  actionMap[state] = frozenList(...actionMap[state], "cancel");
}

export const AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1: Readonly<
  Record<AuthenticatorUiStateIdV1, readonly AuthenticatorUiActionV1[]>
> = Object.freeze(actionMap);

function visualForState(state: AuthenticatorUiStateIdV1): AuthenticatorUiVisualSourceV1 {
  if (state === "request_review") return "figma_5132_134352";
  if (
    state === "demo_authenticator_intro" ||
    state === "session_creating" ||
    state === "demo_authenticator_pending" ||
    state === "session_completing_authenticator" ||
    state === "demo_authenticator_ready"
  ) {
    return "figma_5132_134394";
  }
  if (state === "demo_authenticator_unavailable") return "figma_5132_134441";
  if (state === "demo_authenticator_non_completion") return "figma_5132_134488";
  if (
    state === "demo_authenticator_transport_failure" ||
    state === "demo_authenticator_invalid_response"
  ) {
    return "figma_5132_134535";
  }
  if (state === "capture_intro" || state === "capture_permission_request") {
    return "figma_5132_134643";
  }
  if (
    state === "capture_acquiring" ||
    state === "capture_preparing" ||
    state === "capture_preview" ||
    state === "capture_guidance_adjust" ||
    state === "capture_guidance_retake" ||
    state === "capture_guidance_unavailable"
  ) {
    return "figma_5132_134743";
  }
  if (state === "capture_sampling") return "figma_5132_134841";
  if (
    state === "capture_artifact_ready" ||
    state === "capture_cleaning" ||
    state === "capture_complete"
  ) {
    return "figma_5132_134939";
  }
  if (state === "biometric_simulation_pending") return "figma_5132_135038";
  if (state === "biometric_simulated_pass" || state === "issuance_simulation_pending") {
    return "figma_5132_135071";
  }
  if (state === "simulated_credential_ready" || state === "return_redirecting") {
    return "figma_5132_135104";
  }
  if (state.startsWith("biometric_") || state.startsWith("issuance_")) {
    return "not_figma_verified";
  }
  return "verified_template";
}

export const AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1: Readonly<
  Record<AuthenticatorUiStateIdV1, AuthenticatorUiVisualSourceV1>
> = Object.freeze(Object.fromEntries(
  AUTHENTICATOR_UI_STATES_V1.map((state) => [state, visualForState(state)]),
) as Record<AuthenticatorUiStateIdV1, AuthenticatorUiVisualSourceV1>);

function eventPayloadIsValid(value: AuthenticatorUiEventV1): boolean {
  if (value.event === "request_accepted") {
    return value.rpPresentationId !== null &&
      value.detailCode === null &&
      value.authoritativeSessionState === null;
  }
  if (value.event === "authoritative_session") {
    return value.authoritativeSessionState !== null &&
      value.detailCode === null &&
      value.rpPresentationId === null;
  }
  if (value.event === "quality_adjust") {
    return value.detailCode !== null && ADJUST_CODES.has(value.detailCode) &&
      value.authoritativeSessionState === null && value.rpPresentationId === null;
  }
  if (value.event === "quality_retake") {
    return value.detailCode === "image_blurry" &&
      value.authoritativeSessionState === null && value.rpPresentationId === null;
  }
  if (value.event === "quality_unavailable") {
    return value.detailCode !== null && UNAVAILABLE_GUIDANCE_CODES.has(value.detailCode) &&
      value.authoritativeSessionState === null && value.rpPresentationId === null;
  }
  if (value.event === "capture_failed") {
    return value.detailCode !== null && CAPTURE_ERROR_CODES.has(value.detailCode) &&
      value.authoritativeSessionState === null && value.rpPresentationId === null;
  }
  if (value.event === "session_failed") {
    return value.detailCode !== null && SESSION_ERROR_CODES.has(value.detailCode) &&
      value.authoritativeSessionState === null && value.rpPresentationId === null;
  }
  if (value.event === "return_failed") {
    return value.detailCode !== null && CALLBACK_ERROR_CODES.has(value.detailCode) &&
      value.authoritativeSessionState === null && value.rpPresentationId === null;
  }
  if (value.event === "fatal_error") {
    return value.detailCode === "safe_internal_error" &&
      value.authoritativeSessionState === null && value.rpPresentationId === null;
  }
  return value.detailCode === null &&
    value.authoritativeSessionState === null &&
    value.rpPresentationId === null;
}

export function isAuthenticatorUiEventV1(value: unknown): value is AuthenticatorUiEventV1 {
  try {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        "kind",
        "version",
        "mode",
        "environment",
        "event",
        "detailCode",
        "authoritativeSessionState",
        "rpPresentationId",
      ]) ||
      value.kind !== AUTHENTICATOR_UI_EVENT_V1 ||
      value.version !== AUTHENTICATOR_UI_FLOW_V1 ||
      value.mode !== SIMULATION_MODE ||
      value.environment !== SIMULATION_ENVIRONMENT ||
      typeof value.event !== "string" ||
      !AUTHENTICATOR_UI_EVENTS_V1.includes(value.event as AuthenticatorUiEventTypeV1) ||
      (value.detailCode !== null &&
        (typeof value.detailCode !== "string" ||
          !AUTHENTICATOR_UI_DETAIL_CODES_V1.includes(
            value.detailCode as AuthenticatorUiDetailCodeV1,
          ))) ||
      (value.authoritativeSessionState !== null &&
        (typeof value.authoritativeSessionState !== "string" ||
          !ENROLLMENT_SESSION_STATES_V2.includes(
            value.authoritativeSessionState as EnrollmentSessionStateV2,
          ))) ||
      (value.rpPresentationId !== null &&
        (typeof value.rpPresentationId !== "string" ||
          !RP_PRESENTATION_IDS_V0.includes(value.rpPresentationId as RpPresentationIdV0)))
    ) {
      return false;
    }
    return eventPayloadIsValid(value as unknown as AuthenticatorUiEventV1);
  } catch {
    return false;
  }
}

interface StaticTransitionV1 {
  readonly state: AuthenticatorUiStateIdV1;
  readonly effects: readonly AuthenticatorUiEffectV1[];
}

const staticTransition = (
  state: AuthenticatorUiStateIdV1,
  ...effects: readonly AuthenticatorUiEffectV1[]
): StaticTransitionV1 => Object.freeze({ state, effects: frozenList(...effects) });

const STATIC_TRANSITIONS_V1: Readonly<Record<string, StaticTransitionV1>> = Object.freeze({
  "request_checking|request_accepted": staticTransition("request_review"),
  "request_checking|request_invalid": staticTransition("request_invalid"),
  "request_checking|request_expired": staticTransition("request_expired"),
  "request_checking|request_return_target_invalid": staticTransition("request_return_target_invalid"),
  "request_checking|request_rp_identity_unavailable": staticTransition("request_rp_identity_unavailable"),
  "request_review|continue": staticTransition("admission_checking", "evaluate_admission"),
  "admission_checking|admission_safari_candidate": staticTransition("admission_safari_candidate"),
  "admission_checking|admission_chrome_candidate": staticTransition("admission_chrome_candidate"),
  "admission_checking|admission_handoff_required": staticTransition("admission_handoff_required"),
  "admission_checking|admission_update_required": staticTransition("admission_update_required"),
  "admission_checking|admission_unsupported": staticTransition("admission_unsupported"),
  "admission_checking|admission_insecure": staticTransition("admission_insecure"),
  "admission_checking|admission_framed": staticTransition("admission_framed"),
  "admission_checking|admission_private": staticTransition("admission_private"),
  "admission_checking|admission_pwa": staticTransition("admission_pwa"),
  "admission_checking|admission_unknown": staticTransition("admission_unknown"),
  "admission_safari_candidate|continue": staticTransition("demo_authenticator_intro"),
  "admission_chrome_candidate|continue": staticTransition("demo_authenticator_intro"),
  "admission_handoff_required|handoff_started": staticTransition(
    "admission_handoff_departing",
    "open_external_browser",
  ),
  "admission_handoff_departing|handoff_failed": staticTransition("admission_handoff_failed"),
  "demo_authenticator_intro|start_demo_authenticator": staticTransition(
    "session_creating",
    "create_session",
  ),
  "demo_authenticator_pending|demo_authenticator_ready": staticTransition(
    "session_completing_authenticator",
    "complete_demo_authenticator",
  ),
  "demo_authenticator_pending|demo_authenticator_non_completion": staticTransition(
    "demo_authenticator_non_completion",
  ),
  "demo_authenticator_pending|demo_authenticator_unavailable": staticTransition(
    "demo_authenticator_unavailable",
  ),
  "demo_authenticator_pending|demo_authenticator_interrupted": staticTransition(
    "demo_authenticator_interrupted",
  ),
  "demo_authenticator_pending|demo_authenticator_transport_failure": staticTransition(
    "demo_authenticator_transport_failure",
  ),
  "demo_authenticator_pending|demo_authenticator_invalid_response": staticTransition(
    "demo_authenticator_invalid_response",
  ),
  "demo_authenticator_non_completion|try_again": staticTransition(
    "demo_authenticator_pending",
    "begin_demo_authenticator",
  ),
  "demo_authenticator_interrupted|try_again": staticTransition(
    "demo_authenticator_pending",
    "begin_demo_authenticator",
  ),
  "demo_authenticator_transport_failure|status_requested": staticTransition(
    "session_reconciling",
    "query_status",
  ),
  "demo_authenticator_ready|continue_to_camera": staticTransition(
    "capture_policy_loading",
    "prepare_capture",
  ),
  "capture_intro|start_camera": staticTransition("capture_permission_request", "start_capture"),
  "capture_intro|capture_permission_requested": staticTransition("capture_permission_request"),
  "capture_permission_request|capture_acquiring": staticTransition("capture_acquiring"),
  "capture_acquiring|capture_preparing": staticTransition("capture_preparing"),
  "capture_preparing|capture_preview": staticTransition("capture_preview"),
  "capture_preview|quality_ready": staticTransition("capture_sampling", "collect_frame_metadata"),
  "capture_sampling|capture_sampling": staticTransition("capture_sampling"),
  "capture_preview|quality_adjust": staticTransition(
    "capture_guidance_adjust",
    "stop_capture",
    "clear_transient_media",
  ),
  "capture_preview|quality_retake": staticTransition(
    "capture_guidance_retake",
    "stop_capture",
    "clear_transient_media",
  ),
  "capture_preview|quality_unavailable": staticTransition(
    "capture_guidance_unavailable",
    "stop_capture",
    "clear_transient_media",
  ),
  "capture_guidance_adjust|try_again": staticTransition("capture_permission_request", "start_capture"),
  "capture_guidance_retake|retake": staticTransition("capture_permission_request", "start_capture"),
  "capture_guidance_unavailable|continue_without_guidance": staticTransition(
    "capture_sampling",
    "start_capture",
    "collect_frame_metadata",
  ),
  "capture_sampling|capture_artifact_ready": staticTransition(
    "capture_artifact_ready",
    "stop_capture",
    "clear_transient_media",
  ),
  "capture_artifact_ready|cleanup_started": staticTransition("capture_cleaning"),
  "capture_artifact_ready|cleanup_complete": staticTransition("capture_complete", "submit_capture"),
  "capture_cleaning|cleanup_complete": staticTransition("capture_complete", "submit_capture"),
  "capture_error|try_again": staticTransition("capture_permission_request", "start_capture"),
  "biometric_simulated_retry|retake": staticTransition("capture_policy_loading", "prepare_capture"),
  "biometric_simulated_unavailable|retry_requested": staticTransition(
    "session_reconciling",
    "retry_unavailable",
  ),
  "biometric_simulated_unavailable|status_requested": staticTransition(
    "session_reconciling",
    "query_status",
  ),
  "issuance_simulated_unavailable|retry_requested": staticTransition(
    "session_reconciling",
    "retry_unavailable",
  ),
  "issuance_simulated_unavailable|status_requested": staticTransition(
    "session_reconciling",
    "query_status",
  ),
  "session_error|status_requested": staticTransition(
    "session_reconciling",
    "query_status",
  ),
  "return_callback_failed|return_requested": staticTransition("return_redirecting", "return_to_rp"),
  "return_redirecting|return_failed": staticTransition("return_callback_failed"),
  "return_redirecting|return_completed": staticTransition("returned"),
});

const AUTHORITATIVE_STATUS_STATES = new Set<AuthenticatorUiStateIdV1>([
  "session_creating",
  "demo_authenticator_pending",
  "session_completing_authenticator",
  "capture_policy_loading",
  "capture_complete",
  "biometric_simulation_pending",
  "biometric_simulated_pass",
  "biometric_simulated_unavailable",
  "issuance_simulation_pending",
  "issuance_simulated_unavailable",
  "session_reconciling",
  "flow_cancelling",
]);

const LIFECYCLE_ABORT_EVENTS = new Set<AuthenticatorUiEventTypeV1>([
  "page_hidden",
  "page_unloaded",
  "orientation_invalidated",
  "component_unmounted",
  "operation_interrupted",
]);

function isProgress(value: unknown, state: AuthenticatorUiStateIdV1): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["stage", "status"])) return false;
  const expected = AUTHENTICATOR_UI_STATE_PROGRESS_V1[state];
  return value.stage === expected.stage && value.status === expected.status;
}

export function isAuthenticatorUiSnapshotV1(value: unknown): value is AuthenticatorUiSnapshotV1 {
  try {
    if (!isRecord(value)) return false;
    if (
      !hasExactKeys(value, [
        "kind",
        "version",
        "mode",
        "environment",
        "state",
        "progress",
        "detailCode",
        "authoritativeSessionState",
        "rpPresentationId",
        "visualSource",
      ]) ||
      value.kind !== AUTHENTICATOR_UI_SNAPSHOT_V1 ||
      value.version !== AUTHENTICATOR_UI_FLOW_V1 ||
      value.mode !== SIMULATION_MODE ||
      value.environment !== SIMULATION_ENVIRONMENT ||
      typeof value.state !== "string" ||
      !AUTHENTICATOR_UI_STATES_V1.includes(value.state as AuthenticatorUiStateIdV1) ||
      (value.detailCode !== null &&
        (typeof value.detailCode !== "string" ||
          !AUTHENTICATOR_UI_DETAIL_CODES_V1.includes(value.detailCode as AuthenticatorUiDetailCodeV1))) ||
      (value.authoritativeSessionState !== null &&
        (typeof value.authoritativeSessionState !== "string" ||
          !ENROLLMENT_SESSION_STATES_V2.includes(value.authoritativeSessionState as EnrollmentSessionStateV2))) ||
      (value.rpPresentationId !== null &&
        (typeof value.rpPresentationId !== "string" ||
          !RP_PRESENTATION_IDS_V0.includes(value.rpPresentationId as RpPresentationIdV0))) ||
      typeof value.visualSource !== "string" ||
      !AUTHENTICATOR_UI_VISUAL_SOURCES_V1.includes(value.visualSource as AuthenticatorUiVisualSourceV1)
    ) {
      return false;
    }
    const state = value.state as AuthenticatorUiStateIdV1;
    const authoritativeSessionState =
      value.authoritativeSessionState as EnrollmentSessionStateV2 | null;
    return (
      isProgress(value.progress, state) &&
      detailMatchesState(state, value.detailCode as AuthenticatorUiDetailCodeV1 | null) &&
      authoritativeStateMatchesUi(state, authoritativeSessionState)
    );
  } catch {
    return false;
  }
}

export function makeAuthenticatorUiSnapshotV1(input: {
  readonly state: AuthenticatorUiStateIdV1;
  readonly detailCode?: AuthenticatorUiDetailCodeV1 | null;
  readonly authoritativeSessionState?: EnrollmentSessionStateV2 | null;
  readonly rpPresentationId?: RpPresentationIdV0 | null;
  readonly visualSource?: AuthenticatorUiVisualSourceV1;
}): AuthenticatorUiSnapshotV1 {
  const snapshot: AuthenticatorUiSnapshotV1 = Object.freeze({
    kind: AUTHENTICATOR_UI_SNAPSHOT_V1,
    version: AUTHENTICATOR_UI_FLOW_V1,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    state: input.state,
    progress: Object.freeze({ ...AUTHENTICATOR_UI_STATE_PROGRESS_V1[input.state] }),
    detailCode: input.detailCode ?? null,
    authoritativeSessionState: input.authoritativeSessionState ?? null,
    rpPresentationId: input.rpPresentationId ?? null,
    visualSource: input.visualSource ?? "none",
  });
  if (!isAuthenticatorUiSnapshotV1(snapshot)) {
    throw new TypeError("invalid_authenticator_ui_snapshot_v1");
  }
  return snapshot;
}

export function makeAuthenticatorUiEventV1(input: {
  readonly event: AuthenticatorUiEventTypeV1;
  readonly detailCode?: AuthenticatorUiDetailCodeV1 | null;
  readonly authoritativeSessionState?: EnrollmentSessionStateV2 | null;
  readonly rpPresentationId?: RpPresentationIdV0 | null;
}): AuthenticatorUiEventV1 {
  const event: AuthenticatorUiEventV1 = Object.freeze({
    kind: AUTHENTICATOR_UI_EVENT_V1,
    version: AUTHENTICATOR_UI_FLOW_V1,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    event: input.event,
    detailCode: input.detailCode ?? null,
    authoritativeSessionState: input.authoritativeSessionState ?? null,
    rpPresentationId: input.rpPresentationId ?? null,
  });
  if (!isAuthenticatorUiEventV1(event)) {
    throw new TypeError("invalid_authenticator_ui_event_v1");
  }
  return event;
}

export function projectSimulatorBrowserErrorToUiEventV1(
  value: unknown,
): AuthenticatorUiEventV1 | null {
  if (!isSimulatorBrowserSessionErrorV0(value)) return null;
  const error = value as SimulatorBrowserSessionErrorV0;
  if (error.operation === "begin_demo_authenticator") {
    if (error.reasonCode === "user_non_completion") {
      return makeAuthenticatorUiEventV1({ event: "demo_authenticator_non_completion" });
    }
    if (error.reasonCode === "demo_authenticator_unavailable") {
      return makeAuthenticatorUiEventV1({ event: "demo_authenticator_unavailable" });
    }
    if (error.reasonCode === "demo_authenticator_interrupted") {
      return makeAuthenticatorUiEventV1({ event: "demo_authenticator_interrupted" });
    }
    if (
      error.reasonCode === "network_unavailable" ||
      error.reasonCode === "network_timeout"
    ) {
      return makeAuthenticatorUiEventV1({ event: "demo_authenticator_transport_failure" });
    }
    return makeAuthenticatorUiEventV1({ event: "demo_authenticator_invalid_response" });
  }
  if (error.operation === "return_to_rp") {
    return makeAuthenticatorUiEventV1({
      event: "return_failed",
      detailCode: "navigation_failed",
    });
  }
  if (error.operation === "bootstrap") {
    return makeAuthenticatorUiEventV1({
      event: "fatal_error",
      detailCode: "safe_internal_error",
    });
  }
  if (error.operation === "create_session") {
    return makeAuthenticatorUiEventV1({
      event: "fatal_error",
      detailCode: "safe_internal_error",
    });
  }
  const detailCode = SESSION_ERROR_CODES.has(
    error.reasonCode as AuthenticatorUiDetailCodeV1,
  )
    ? error.reasonCode as AuthenticatorUiDetailCodeV1
    : "response_invalid";
  return makeAuthenticatorUiEventV1({ event: "session_failed", detailCode });
}

export function transitionAuthenticatorUiV1(
  current: AuthenticatorUiSnapshotV1,
  event: AuthenticatorUiEventV1,
): AuthenticatorUiTransitionV1 | null {
  if (!isAuthenticatorUiSnapshotV1(current) || !isAuthenticatorUiEventV1(event)) {
    return null;
  }
  if (TERMINAL_STATE_SET.has(current.state)) {
    if (
      (event.event !== "return_requested" && event.event !== "local_close_requested") ||
      (event.event === "return_requested" &&
        !AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[current.state].includes("return_to_rp")) ||
      (event.event === "local_close_requested" &&
        !AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[current.state].includes("close"))
    ) {
      return null;
    }
  }

  let nextState: AuthenticatorUiStateIdV1;
  let effects: readonly AuthenticatorUiEffectV1[] = frozenList();
  let detailCode: AuthenticatorUiDetailCodeV1 | null = event.detailCode;
  let authoritativeSessionState = current.authoritativeSessionState;
  let rpPresentationId = current.rpPresentationId;

  if (event.event === "authoritative_session") {
    if (!AUTHORITATIVE_STATUS_STATES.has(current.state)) return null;
    const serverState = event.authoritativeSessionState;
    if (serverState === null) return null;
    nextState = ENROLLMENT_SESSION_TO_UI_STATE_V1[serverState];
    authoritativeSessionState = serverState;
    detailCode = null;
    if (serverState === "created") effects = frozenList("begin_demo_authenticator");
  } else if (event.event === "cancel_requested") {
    if (!AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[current.state].includes("cancel")) return null;
    nextState = "flow_cancelling";
    effects = current.authoritativeSessionState === null
      ? frozenList("abort_active_effects", "stop_capture", "clear_transient_media")
      : frozenList(
          "abort_active_effects",
          "stop_capture",
          "clear_transient_media",
          "cancel_session",
        );
    detailCode = null;
  } else if (LIFECYCLE_ABORT_EVENTS.has(event.event)) {
    if (TERMINAL_STATE_SET.has(current.state) || current.state === "flow_cancelling") {
      return null;
    }
    nextState = "flow_cancelling";
    effects = current.authoritativeSessionState === null
      ? frozenList("abort_active_effects", "stop_capture", "clear_transient_media")
      : frozenList(
          "abort_active_effects",
          "stop_capture",
          "clear_transient_media",
          "cancel_session",
        );
    detailCode = null;
  } else if (event.event === "local_cancel_complete") {
    if (current.state !== "flow_cancelling" || current.authoritativeSessionState !== null) {
      return null;
    }
    nextState = "flow_cancelled";
    detailCode = null;
  } else if (event.event === "session_expired") {
    if (TERMINAL_STATE_SET.has(current.state)) return null;
    nextState = "flow_expired";
    effects = frozenList("abort_active_effects", "stop_capture", "clear_transient_media");
    detailCode = null;
    authoritativeSessionState = null;
  } else if (event.event === "fatal_error") {
    nextState = "flow_failed";
    effects = frozenList("abort_active_effects", "stop_capture", "clear_transient_media");
    authoritativeSessionState = null;
  } else if (event.event === "session_failed") {
    if (current.state === "session_creating" && current.authoritativeSessionState === null) {
      nextState = "flow_failed";
      effects = frozenList("abort_active_effects", "stop_capture", "clear_transient_media");
      detailCode = "safe_internal_error";
      authoritativeSessionState = null;
    } else if (!AUTHORITATIVE_STATUS_STATES.has(current.state)) {
      return null;
    } else {
      nextState = "session_error";
    }
  } else if (event.event === "capture_failed") {
    if (!current.state.startsWith("capture_")) return null;
    nextState = "capture_error";
    effects = frozenList("abort_active_effects", "stop_capture", "clear_transient_media");
  } else if (event.event === "local_close_requested") {
    if (!AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[current.state].includes("close")) {
      return null;
    }
    nextState = "flow_closed";
    effects = frozenList(
      "abort_active_effects",
      "stop_capture",
      "clear_transient_media",
      "close_locally",
    );
    detailCode = null;
    authoritativeSessionState = null;
  } else if (event.event === "return_requested") {
    const allowedActions = AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[current.state];
    if (!allowedActions.includes("return_to_rp")) return null;
    nextState = "return_redirecting";
    effects = frozenList(
      "abort_active_effects",
      "stop_capture",
      "clear_transient_media",
      "return_to_rp",
    );
    detailCode = null;
    authoritativeSessionState = null;
  } else {
    const transition = STATIC_TRANSITIONS_V1[`${current.state}|${event.event}`];
    if (transition === undefined) return null;
    nextState = transition.state;
    effects = transition.effects;
    if (event.event === "request_accepted") {
      rpPresentationId = event.rpPresentationId;
    }
  }

  try {
    const snapshot = makeAuthenticatorUiSnapshotV1({
      state: nextState,
      detailCode,
      authoritativeSessionState,
      rpPresentationId,
      visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[nextState],
    });
    return Object.freeze({ snapshot, effects });
  } catch {
    return null;
  }
}

export function dispatchAuthenticatorUiActionV1(
  current: AuthenticatorUiSnapshotV1,
  action: AuthenticatorUiActionV1,
): AuthenticatorUiTransitionV1 | null {
  if (
    !isAuthenticatorUiSnapshotV1(current) ||
    !AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[current.state].includes(action)
  ) {
    return null;
  }
  if (action === "collect_frame_metadata") {
    return Object.freeze({
      snapshot: current,
      effects: frozenList<AuthenticatorUiEffectV1>("evaluate_quality"),
    });
  }
  const eventType: AuthenticatorUiEventTypeV1 =
    action === "cancel"
      ? "cancel_requested"
      : action === "open_external_browser"
        ? "handoff_started"
        : action === "start_demo_authenticator"
          ? "start_demo_authenticator"
          : action === "continue_to_camera"
            ? "continue_to_camera"
            : action === "start_camera"
              ? "start_camera"
              : action === "try_again"
                ? "try_again"
                : action === "continue_without_guidance"
                  ? "continue_without_guidance"
                  : action === "retake"
                    ? "retake"
                    : action === "retry_same_operation"
                      ? "retry_requested"
                      : action === "query_status"
                        ? "status_requested"
                        : action === "return_to_rp"
                          ? "return_requested"
                          : action === "close"
                            ? "local_close_requested"
                            : "continue";
  return transitionAuthenticatorUiV1(current, makeAuthenticatorUiEventV1({
    event: eventType,
  }));
}

export function projectEnrollmentSessionStateToUiV1(
  state: EnrollmentSessionStateV2,
  input: Omit<Parameters<typeof makeAuthenticatorUiSnapshotV1>[0], "state" | "authoritativeSessionState"> = {},
): AuthenticatorUiSnapshotV1 {
  return makeAuthenticatorUiSnapshotV1({
    ...input,
    state: ENROLLMENT_SESSION_TO_UI_STATE_V1[state],
    authoritativeSessionState: state,
  });
}

export function assertAuthenticatorUiSnapshotAllowed(
  runtimeEnvironment: RuntimeEnvironment,
  value: unknown,
): void {
  assertSimulationArtifactAllowed(runtimeEnvironment, value);
}

export function assertAuthenticatorUiEventAllowed(
  runtimeEnvironment: RuntimeEnvironment,
  value: unknown,
): void {
  assertSimulationArtifactAllowed(runtimeEnvironment, value);
}

// UI snapshots are categorical presentation state only. They are not telemetry,
// security evidence, biometric results, or proof that any external operation ran.
