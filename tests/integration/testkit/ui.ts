import {
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1,
  ENROLLMENT_SESSION_STATES_V2,
  makeAuthenticatorUiSnapshotV1,
  type AuthenticatorUiDetailCodeV1,
  type AuthenticatorUiStateIdV1,
  type EnrollmentSessionStateV2,
} from "@clean-start/contracts";

function detailFor(state: AuthenticatorUiStateIdV1): AuthenticatorUiDetailCodeV1 | null {
  if (state === "capture_guidance_adjust") return "move_closer";
  if (state === "capture_guidance_retake") return "image_blurry";
  if (state === "capture_guidance_unavailable") return "framing_guidance_unavailable";
  if (state === "capture_error") return "permission_denied";
  if (state === "session_error") return "network_timeout";
  if (state === "return_callback_failed") return "navigation_failed";
  if (state === "flow_failed") return "safe_internal_error";
  return null;
}

function authoritativeFor(state: AuthenticatorUiStateIdV1): EnrollmentSessionStateV2 | null {
  for (const serverState of ENROLLMENT_SESSION_STATES_V2) {
    if (ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1[serverState].includes(state)) {
      return serverState;
    }
  }
  return null;
}

export function snapshotFor(state: AuthenticatorUiStateIdV1) {
  return makeAuthenticatorUiSnapshotV1({
    state,
    detailCode: detailFor(state),
    authoritativeSessionState: authoritativeFor(state),
    rpPresentationId: state === "request_checking" ? null : "zoom_demo",
    visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[state],
  });
}
