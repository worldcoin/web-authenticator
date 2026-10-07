import type {
  AuthenticatorUiActionV1,
  AuthenticatorUiDetailCodeV1,
  AuthenticatorUiStateIdV1,
} from "@clean-start/contracts";
import { FIGMA_ASSET_PATHS_V1 } from "../assets/provenance";
import type { FlowScreenDisclosureV1, FlowScreenHeroV1 } from "../components/FlowScreen";

export interface WalkthroughCopyV1 {
  readonly heading: string;
  readonly body: string;
  readonly primaryAction?: string;
}

function copy(heading: string, body = "", primaryAction?: string): WalkthroughCopyV1 {
  return Object.freeze(
    primaryAction === undefined ? { heading, body } : { heading, body, primaryAction },
  );
}

export const WALKTHROUGH_RP_NAME_V1 = "Zoom" as const;

// Figma 5132:134643 body. The app skips that separate intro screen: this
// sentence and its "Start selfie check" action live on the passkey-created
// screen, and the intro state auto-advances into the camera before it paints.
export const SELFIE_CHECK_INTRO_BODY_V1 =
  "Use your camera to confirm that you’re a real, unique person. The check should take less than a minute." as const;

/** Mirrors `AUTHENTICATOR_RP_PRESENTATIONS_V0.zoom_demo.returnLabel` (server-owned). */
export const WALKTHROUGH_RETURN_LABEL_V1 = "Return to Zoom" as const;

// Exact Figma copy is used where a frame exists:
//   5132:134352 request, 5132:134394/134441/134488/134535 passkey,
//   5132:134643 camera intro, 5132:134743/134841/134939/135141 capture,
//   5132:135038/135071 verifying, 5132:135104 success.
// Copy is used verbatim, including Figma’s "This might take few seconds".
export const WALKTHROUGH_COPY_V1: Readonly<Record<AuthenticatorUiStateIdV1, WalkthroughCopyV1>> =
  Object.freeze({
    request_checking: copy("Loading"),
    request_review: copy(
      "Request from Zoom",
      "Confirm you’re a real person with selfie check without sharing identity",
      "Continue",
    ),
    request_invalid: copy("Request not valid", "Close this tab, then start again from Zoom."),
    request_expired: copy("Request expired", "Close this tab, then start again from Zoom."),
    request_return_target_invalid: copy("Cannot return safely", "The return destination was not approved."),
    request_rp_identity_unavailable: copy("App details unavailable", "The requesting app could not be verified."),
    admission_checking: copy("Checking browser"),
    admission_safari_candidate: copy("Continue in Safari", "", "Continue"),
    admission_chrome_candidate: copy("Continue in Chrome", "", "Continue"),
    admission_handoff_required: copy(
      "Open in Safari or Chrome",
      "Continue in your browser to complete the selfie check.",
      "Open browser",
    ),
    admission_handoff_departing: copy("Opening browser"),
    admission_handoff_failed: copy("Browser could not open", "Close this tab and try again from Zoom."),
    admission_update_required: copy("Update iOS to continue", "Selfie check needs iOS 18 or later in Safari or Chrome."),
    admission_unsupported: copy("Device not supported", "Selfie check runs on supported iPhone browsers."),
    admission_insecure: copy("Secure page required", "Open the secure link from Zoom to continue."),
    admission_framed: copy("Open the page directly", "Selfie check can’t run inside another page."),
    admission_private: copy("Use a normal browser tab", "Private browsing isn’t supported for selfie check."),
    admission_pwa: copy("Use Safari or Chrome", "Installed web-app mode isn’t supported for selfie check."),
    admission_unknown: copy("Browser not supported", "Open this link in Safari or Chrome on your iPhone."),
    demo_authenticator_intro: copy(
      "Secure your World ID",
      "Create a passkey so you can use and recover this World ID on supported devices.",
      "Create passkey",
    ),
    session_creating: copy("Starting"),
    demo_authenticator_pending: copy("Creating passkey"),
    session_completing_authenticator: copy("Creating passkey"),
    demo_authenticator_ready: copy("Passkey created", SELFIE_CHECK_INTRO_BODY_V1, "Start selfie check"),
    demo_authenticator_non_completion: copy(
      "Passkey not created",
      "Create a passkey to secure your World ID and continue the human check.",
      "Try again",
    ),
    demo_authenticator_unavailable: copy(
      "Passkeys aren’t available",
      "This device or browser can’t create the passkey needed to secure your World ID.",
      WALKTHROUGH_RETURN_LABEL_V1,
    ),
    demo_authenticator_interrupted: copy(
      "Passkey not created",
      "Create a passkey to secure your World ID and continue the human check.",
      "Try again",
    ),
    demo_authenticator_transport_failure: copy(
      "Unable to create a passkey",
      "Check your connection and try again. Your World ID hasn’t been created.",
      "Try again",
    ),
    demo_authenticator_invalid_response: copy(
      "Unable to create a passkey",
      "Something went wrong. Your World ID hasn’t been created.",
      WALKTHROUGH_RETURN_LABEL_V1,
    ),
    session_reconciling: copy("Checking status"),
    session_error: copy(
      "Connection interrupted",
      "Check your connection, then check the status to continue.",
      "Check status",
    ),
    capture_policy_loading: copy("Preparing camera"),
    capture_intro: copy("Complete a Selfie Check", SELFIE_CHECK_INTRO_BODY_V1, "Start selfie check"),
    capture_permission_request: copy("Allow camera access"),
    capture_acquiring: copy("Opening camera"),
    capture_preparing: copy("Opening camera"),
    capture_preview: copy("Place your face in the oval", "Position your face inside the oval, then hold steady."),
    capture_guidance_adjust: copy("Adjust your position", "Follow the on-screen guidance, then try again.", "Try again"),
    capture_guidance_retake: copy("Let’s try that again", "Hold your phone steady and retake your selfie.", "Retake"),
    capture_guidance_unavailable: copy("Guidance unavailable", "You can continue without on-screen guidance.", "Continue"),
    capture_sampling: copy("Great position, hold steady"),
    capture_artifact_ready: copy("You’re all set"),
    capture_cleaning: copy("You’re all set"),
    capture_complete: copy("You’re all set"),
    capture_error: copy("Camera unavailable", "Allow camera access, then try again.", "Try again"),
    biometric_simulation_pending: copy("Verifying your selfie", "This might take few seconds"),
    biometric_simulated_pass: copy("Verifying your selfie", "This might take few seconds"),
    biometric_simulated_reject: copy(
      "Selfie check unsuccessful",
      "We couldn’t verify your selfie this time.",
      WALKTHROUGH_RETURN_LABEL_V1,
    ),
    biometric_simulated_retry: copy("Let’s try that again", "Retake your selfie in good lighting.", "Retake"),
    biometric_simulated_unavailable: copy(
      "Verification unavailable",
      "We couldn’t reach the verification service. Try again.",
      "Try again",
    ),
    issuance_simulation_pending: copy("Verifying your selfie", "This might take few seconds"),
    issuance_simulated_reject: copy(
      "Unable to complete",
      "Your selfie check couldn’t be completed.",
      WALKTHROUGH_RETURN_LABEL_V1,
    ),
    issuance_simulated_unavailable: copy(
      "Almost there",
      "We couldn’t finish your selfie check. Try again.",
      "Try again",
    ),
    simulated_credential_ready: copy("Preview complete", "Simulated result — no Selfie Check credential was issued.", WALKTHROUGH_RETURN_LABEL_V1),
    return_redirecting: copy("You’re all set", "Returning to Zoom"),
    return_callback_failed: copy("Couldn’t return to Zoom", "Try again to continue in Zoom.", "Try again"),
    returned: copy("Returned to Zoom", "This preview did not send a proof to Zoom. You can close this tab."),
    flow_cancelling: copy("Cancelling"),
    flow_cancelled: copy("Cancelled", "You can start again from Zoom."),
    flow_closed: copy("You can close this tab"),
    flow_expired: copy("Session expired", "Start again from Zoom."),
    flow_failed: copy("Something went wrong", "Start again from Zoom."),
  });

export const WALKTHROUGH_PASSKEY_READY_COPY_V1 = Object.freeze({
  created: copy("Wallet unlocked", SELFIE_CHECK_INTRO_BODY_V1, "Start selfie check"),
  notCreated: copy(
    "Continue without a passkey",
    `Passkey creation was not completed. ${SELFIE_CHECK_INTRO_BODY_V1}`,
    "Start selfie check",
  ),
});

// Detail lines whose frozen contract wording names the staging environment.
export const WALKTHROUGH_DETAIL_COPY_V1: Readonly<Partial<Record<AuthenticatorUiDetailCodeV1, string>>> =
  Object.freeze({
    retake_limit_reached: "The retake limit was reached.",
    policy_invalid: "The capture settings are not valid.",
    prf_not_ready: "This step isn’t ready yet. Try again.",
    unsupported_context: "This browser can’t start the camera.",
    session_expired: "Your session expired.",
    artifact_limit: "The capture exceeded its limits.",
    gateway_disabled: "The service is unavailable right now.",
    invalid_request: "The request was not valid.",
    body_too_large: "The request was too large.",
    unauthorized: "The request could not be authenticated.",
    origin_forbidden: "This origin is not approved.",
    not_found: "The session was not found.",
    expired: "Your session expired.",
    invalid_state: "That step isn’t available right now.",
    binding_mismatch: "The operation did not match the current request.",
    replay_rejected: "The operation was already completed.",
    artifact_invalid: "The capture did not meet the requirements.",
    resource_busy: "The service is busy. Try again.",
    network_timeout: "The request timed out.",
    response_invalid: "The response was not valid.",
    safe_internal_error: "Something went wrong.",
  });

export const WALKTHROUGH_ACTION_LABELS_V1 = Object.freeze({
  start_demo_authenticator: "Create passkey",
  continue_to_camera: "Start selfie check",
  start_camera: "Start selfie check",
  collect_frame_metadata: "Continue",
  return_to_rp: WALKTHROUGH_RETURN_LABEL_V1,
  open_external_browser: "Open browser",
  close: "Close",
}) satisfies Partial<Record<AuthenticatorUiActionV1, string>>;

// Figma 5132:134352 "App will receive" rows: proof shared, selfie and passkey not.
export const WALKTHROUGH_DISCLOSURE_V1: FlowScreenDisclosureV1 = Object.freeze({
  partnerIcon: FIGMA_ASSET_PATHS_V1.zoom,
  partnerAlt: WALKTHROUGH_RP_NAME_V1,
  partnerTone: "brand",
  heading: "App will receive",
  rows: Object.freeze([
    Object.freeze({ icon: FIGMA_ASSET_PATHS_V1.humanEmblem, text: "Proof of selfie", included: true }),
    Object.freeze({ icon: FIGMA_ASSET_PATHS_V1.personCircle, text: "Your selfie", included: false }),
    Object.freeze({ icon: FIGMA_ASSET_PATHS_V1.personKey, text: "Your passkey", included: false }),
  ]),
});

// `/demo/returned` stands in for the relying party after the return action.
export const WALKTHROUGH_RETURNED_HERO_V1: FlowScreenHeroV1 = Object.freeze({
  src: FIGMA_ASSET_PATHS_V1.zoom,
  alt: WALKTHROUGH_RP_NAME_V1,
});
