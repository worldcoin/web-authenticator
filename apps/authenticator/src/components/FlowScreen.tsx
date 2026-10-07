import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import {
  AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1,
  AUTHENTICATOR_UI_COPY_V1,
  AUTHENTICATOR_UI_DETAIL_COPY_V1,
  AUTHENTICATOR_UI_STAGING_BANNER_V1,
  type AuthenticatorUiActionV1,
  type AuthenticatorUiDetailCodeV1,
  type AuthenticatorUiSnapshotV1,
  type AuthenticatorUiStateIdV1,
} from "@clean-start/contracts";
import { FIGMA_ASSET_PATHS_V1 } from "../assets/provenance";
import { CAPTURE_OVAL_CLIP_PATH_V1 } from "../assets/capture-oval-geometry";
import { SCREEN_RENDER_REGISTRY_V1 } from "../flow/render-registry";

export interface FlowScreenPropsV1 {
  readonly snapshot: AuthenticatorUiSnapshotV1;
  readonly onAction: (action: AuthenticatorUiActionV1) => void;
  readonly videoRef?: RefObject<HTMLVideoElement | null>;
  readonly canvasRef?: RefObject<HTMLCanvasElement | null>;
  readonly bannerText?: string | null;
  readonly copyOverride?: Partial<{
    readonly heading: string;
    readonly body: string;
    readonly primaryAction: string | null;
    readonly secondaryAction: string | null;
  }>;
  readonly actionLabelOverrides?: Partial<Record<AuthenticatorUiActionV1, string>>;
  readonly actionsDisabled?: boolean;
  readonly disclosure?: FlowScreenDisclosureV1;
  readonly heroOverride?: FlowScreenHeroV1;
  readonly detailCopyOverrides?: Partial<Record<AuthenticatorUiDetailCodeV1, string>>;
  readonly showTemplateNotice?: boolean;
  readonly liveCaptureGuidance?: {
    readonly code: string;
    readonly text: string;
  };
  readonly captureProgress?: number;
  readonly hiddenActions?: readonly AuthenticatorUiActionV1[];
}

export interface FlowScreenDisclosureRowV1 {
  readonly icon: string;
  readonly text: string;
  readonly included: boolean;
}

export interface FlowScreenDisclosureV1 {
  readonly partnerIcon: string;
  readonly partnerAlt: string;
  readonly partnerTone: "brand" | "neutral";
  readonly heading: string;
  readonly rows: readonly FlowScreenDisclosureRowV1[];
}

export interface FlowScreenHeroV1 {
  readonly src: string;
  readonly alt: string;
}

// Default disclosure for the production-gated route: negative assurance only.
export const STAGING_DISCLOSURE_V1: FlowScreenDisclosureV1 = Object.freeze({
  partnerIcon: FIGMA_ASSET_PATHS_V1.zoom,
  partnerAlt: "Zoom",
  partnerTone: "brand",
  heading: "App will receive",
  rows: Object.freeze([
    Object.freeze({ icon: FIGMA_ASSET_PATHS_V1.humanEmblem, text: "Staging workflow result", included: true }),
    Object.freeze({ icon: FIGMA_ASSET_PATHS_V1.personCircle, text: "Camera images stay on this device", included: false }),
    Object.freeze({ icon: FIGMA_ASSET_PATHS_V1.personKey, text: "No passkey or World ID is created", included: false }),
  ]),
});

const ACTION_LABELS: Readonly<Record<AuthenticatorUiActionV1, string>> = {
  continue: "Continue",
  cancel: "Cancel",
  open_external_browser: "Open browser",
  start_demo_authenticator: "Continue with demo authenticator",
  continue_to_camera: "Continue to camera",
  start_camera: "Start camera demo",
  collect_frame_metadata: "Collect frame metadata",
  try_again: "Try again",
  continue_without_guidance: "Continue without guidance",
  retake: "Retake",
  retry_same_operation: "Retry",
  query_status: "Check status",
  return_to_rp: "Return to app",
  close: "Close",
};

function labelFor(
  action: AuthenticatorUiActionV1,
  index: number,
  copy: (typeof AUTHENTICATOR_UI_COPY_V1)[keyof typeof AUTHENTICATOR_UI_COPY_V1],
  overrides?: Partial<Record<AuthenticatorUiActionV1, string>>,
): string {
  if (overrides?.[action] !== undefined) return overrides[action];
  if (index === 0 && copy.primaryAction !== null) return copy.primaryAction;
  if (action === "cancel" && copy.secondaryAction !== null) return copy.secondaryAction;
  if (index === 1 && copy.secondaryAction !== null && action !== "query_status") {
    return copy.secondaryAction;
  }
  return ACTION_LABELS[action];
}

export const AUTHENTICATOR_UI_ALERT_STATES_V1 = Object.freeze([
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
  "demo_authenticator_non_completion",
  "demo_authenticator_unavailable",
  "demo_authenticator_interrupted",
  "demo_authenticator_transport_failure",
  "demo_authenticator_invalid_response",
  "session_error",
  "capture_guidance_adjust",
  "capture_guidance_retake",
  "capture_guidance_unavailable",
  "capture_error",
  "biometric_simulated_reject",
  "biometric_simulated_retry",
  "biometric_simulated_unavailable",
  "issuance_simulated_reject",
  "issuance_simulated_unavailable",
  "return_callback_failed",
  "flow_expired",
  "flow_failed",
] as const satisfies readonly AuthenticatorUiStateIdV1[]);

const ALERT_STATE_SET_V1 = new Set<AuthenticatorUiStateIdV1>(
  AUTHENTICATOR_UI_ALERT_STATES_V1,
);

export function isAuthenticatorUiAlertStateV1(
  state: AuthenticatorUiStateIdV1,
): boolean {
  return ALERT_STATE_SET_V1.has(state);
}

function RequestContentV1({
  heading,
  body,
  disclosure,
}: {
  readonly heading: string;
  readonly body: string;
  readonly disclosure: FlowScreenDisclosureV1;
}) {
  return <div className="request-layout">
    <div className="request-hero">
      <div className={`partner-icon${disclosure.partnerTone === "neutral" ? " partner-icon--world" : ""}`}>
        <img src={disclosure.partnerIcon} alt={disclosure.partnerAlt} />
      </div>
      <div className="message-block">
        <h1 tabIndex={-1}>{heading}</h1>
        {body ? <p>{body}</p> : null}
      </div>
    </div>
    <div className="request-divider" />
    <section className="disclosures" aria-labelledby="disclosure-heading">
      <h2 id="disclosure-heading">{disclosure.heading}</h2>
      {disclosure.rows.map((row) => <DisclosureRowV1
        key={row.text}
        icon={row.icon}
        marker={row.included ? FIGMA_ASSET_PATHS_V1.disclosureCheck : FIGMA_ASSET_PATHS_V1.disclosureX}
        text={row.text}
        muted={!row.included}
      />)}
    </section>
  </div>;
}

function DisclosureRowV1(props: {
  readonly icon: string;
  readonly marker: string;
  readonly text: string;
  readonly muted?: boolean;
}) {
  return <div className={`disclosure-row${props.muted ? " disclosure-row--muted" : ""}`}>
    <img src={props.icon} alt="" aria-hidden="true" />
    <span>{props.text}</span>
    <img src={props.marker} alt={props.muted ? "Not included" : "Included"} />
  </div>;
}

function CenteredContentV1(props: {
  readonly heading: string;
  readonly body: string;
  readonly icon?: string;
  readonly iconMuted?: boolean;
  readonly pending?: boolean;
  readonly partnerIcon?: FlowScreenHeroV1;
  readonly detail?: string;
  readonly notFigmaVerified?: boolean;
}) {
  return <div className="centered-layout">
    {props.notFigmaVerified ? <p className="template-notice">Template view · Not Figma verified</p> : null}
    {props.partnerIcon ? <div className="partner-icon">
      <img src={props.partnerIcon.src} alt={props.partnerIcon.alt} />
    </div> : null}
    {props.icon && !props.partnerIcon ? <img
      className={`hero-icon${props.pending ? " hero-icon--progress" : ""}${props.iconMuted ? " hero-icon--muted" : ""}`}
      src={props.icon}
      alt=""
      aria-hidden="true"
    /> : null}
    <div className="message-block">
      <h1 tabIndex={-1}>{props.heading}</h1>
      {props.body ? <p>{props.body}</p> : null}
      {props.detail ? <p className="detail-copy">{props.detail}</p> : null}
    </div>
  </div>;
}

function CaptureContentV1(props: {
  readonly snapshot: AuthenticatorUiSnapshotV1;
  readonly heading: string;
  readonly body: string;
  readonly liveGuidance?: {
    readonly code: string;
    readonly text: string;
  };
  readonly captureProgress?: number;
}) {
  const isSampling = props.snapshot.visualSource === "figma_5132_134841";
  const isComplete = props.snapshot.visualSource === "figma_5132_134939";
  const staticRing = isComplete
    ? FIGMA_ASSET_PATHS_V1.captureRingComplete
    : isSampling
      ? FIGMA_ASSET_PATHS_V1.captureRingSampling
      : FIGMA_ASSET_PATHS_V1.captureRingReady;
  const dynamicProgress = props.captureProgress === undefined
    ? undefined
    : Math.max(0, Math.min(1, props.captureProgress));
  const progressComplete = dynamicProgress === 1;
  const progressStyle = dynamicProgress === undefined
    ? undefined
    : {
      "--capture-progress-angle": `${dynamicProgress * 360}deg`,
    } as CSSProperties;
  return <>
    <div
      className="capture-visual"
      aria-hidden="true"
      data-capture-progress-dots={dynamicProgress === undefined
        ? undefined
        : Math.round(dynamicProgress * 64)}
    >
      {dynamicProgress === undefined
        ? <img className="capture-ring" src={staticRing} alt="" />
        : <>
          <img
            className="capture-ring capture-ring--base"
            src={FIGMA_ASSET_PATHS_V1.captureRingReady}
            alt=""
          />
          <img
            className={`capture-ring capture-ring--progress${progressComplete ? " capture-ring--progress-complete" : ""}`}
            src={FIGMA_ASSET_PATHS_V1.captureRingComplete}
            alt=""
            style={progressStyle}
          />
        </>}
    </div>
    <div
      className="capture-message"
      role="status"
      aria-live="polite"
      data-live-guidance={props.liveGuidance?.code}
    >
      {isComplete || progressComplete
        ? <img src={FIGMA_ASSET_PATHS_V1.captureCheck} alt="" />
        : null}
      <h1 tabIndex={-1}>{progressComplete
        ? "You’re all set"
        : props.liveGuidance?.text ?? props.heading}</h1>
    </div>
    <p className="sr-only">{props.body}</p>
  </>;
}

export function FlowScreenV1({
  snapshot,
  onAction,
  videoRef,
  canvasRef,
  bannerText = AUTHENTICATOR_UI_STAGING_BANNER_V1,
  copyOverride,
  actionLabelOverrides,
  actionsDisabled = false,
  disclosure = STAGING_DISCLOSURE_V1,
  heroOverride,
  detailCopyOverrides,
  showTemplateNotice = true,
  liveCaptureGuidance,
  captureProgress,
  hiddenActions = [],
}: FlowScreenPropsV1) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const descriptor = SCREEN_RENDER_REGISTRY_V1[snapshot.state];
  const copy = Object.freeze({
    ...AUTHENTICATOR_UI_COPY_V1[snapshot.state],
    ...copyOverride,
  });
  const actions = AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[snapshot.state];
  const detail = snapshot.detailCode === null
    ? undefined
    : detailCopyOverrides?.[snapshot.detailCode] ??
      AUTHENTICATOR_UI_DETAIL_COPY_V1[snapshot.detailCode];
  const captureVisible = descriptor.family === "capture";
  const activeLiveGuidance = snapshot.state === "capture_preview" ||
    snapshot.state === "capture_sampling"
    ? liveCaptureGuidance
    : undefined;

  useEffect(() => {
    const heading = document.querySelector<HTMLHeadingElement>("main h1");
    headingRef.current = heading;
    heading?.focus({ preventScroll: true });
  }, [snapshot.state]);

  const centeredIcon = descriptor.family === "authenticator"
    ? snapshot.state.includes("unavailable") || snapshot.state.includes("non_completion")
      ? FIGMA_ASSET_PATHS_V1.personKeyDisabled
      : FIGMA_ASSET_PATHS_V1.personKeyBlue
    : descriptor.family === "camera_intro"
      ? FIGMA_ASSET_PATHS_V1.selfieEmblem
      : descriptor.family === "simulation_pending"
        ? FIGMA_ASSET_PATHS_V1.simulationProgress
        : descriptor.family === "verification_complete"
          ? FIGMA_ASSET_PATHS_V1.verificationComplete
          : descriptor.family === "success"
            ? FIGMA_ASSET_PATHS_V1.successEmblem
            : undefined;
  const statusIllustration = descriptor.family === "simulation_pending" ||
    descriptor.family === "verification_complete" ||
    descriptor.family === "success";
  const alert = isAuthenticatorUiAlertStateV1(snapshot.state);
  const hasTopCancel = actions.includes("cancel") && [
    "authenticator",
    "camera_intro",
    "capture",
    "simulation_pending",
    "verification_complete",
    "success",
  ].includes(descriptor.family);
  const footerActions = (hasTopCancel
    ? actions.filter((action) => action !== "cancel")
    : actions).filter((action) => !hiddenActions.includes(action));

  return <main
    className={`app-main app-main--${descriptor.family}${hasTopCancel ? " app-main--has-top-close" : ""}`}
    data-state={snapshot.state}
    data-visual-source={snapshot.visualSource}
    data-figma-verification={snapshot.visualSource === "not_figma_verified" ? "not_figma_verified" : "verified_or_template"}
    aria-busy={actionsDisabled || undefined}
  >
    {bannerText ? <p className="staging-banner">{bannerText}</p> : null}
    {hasTopCancel ? <button
      type="button"
      className="top-close"
      aria-label="Cancel"
      data-action="cancel"
      disabled={actionsDisabled}
      onClick={() => onAction("cancel")}
    >
      <img src={FIGMA_ASSET_PATHS_V1.close} alt="" />
    </button> : null}

    <div
      className={`media-host${captureVisible ? " media-host--visible" : ""}`}
      aria-hidden={captureVisible ? undefined : "true"}
    >
      <div
        className="media-clip"
        aria-hidden="true"
        style={captureVisible ? {
          clipPath: CAPTURE_OVAL_CLIP_PATH_V1,
          WebkitClipPath: CAPTURE_OVAL_CLIP_PATH_V1,
        } : undefined}
      >
        <video ref={videoRef} muted playsInline autoPlay />
        <canvas ref={canvasRef} />
      </div>
      {captureVisible ? <CaptureContentV1
        snapshot={snapshot}
        heading={copy.heading}
        body={copy.body}
        liveGuidance={activeLiveGuidance}
        captureProgress={captureProgress}
      /> : null}
    </div>

    <div
      className="screen-content"
      role={alert ? "alert" : snapshot.progress.status === "pending" ? "status" : undefined}
      aria-live={alert ? "assertive" : snapshot.progress.status === "pending" ? "polite" : undefined}
    >
      {descriptor.family === "request" ? <RequestContentV1
        heading={copy.heading}
        body={copy.body}
        disclosure={disclosure}
      /> : null}
      {descriptor.family !== "request" && descriptor.family !== "capture" ? <CenteredContentV1
        heading={copy.heading}
        body={copy.body}
        detail={detail}
        icon={centeredIcon}
        iconMuted={snapshot.state.includes("unavailable") || snapshot.state.includes("non_completion")}
        pending={statusIllustration}
        partnerIcon={heroOverride}
        notFigmaVerified={showTemplateNotice && snapshot.visualSource === "not_figma_verified"}
      /> : null}
    </div>

    {footerActions.length > 0 ? <nav className="actions" aria-label="Screen actions">
      {footerActions.map((action, index) => <button
        key={action}
        type="button"
        data-action={action}
        disabled={actionsDisabled}
        className={index === 0 && action !== "cancel" && action !== "close" ? "primary-action" : "secondary-action"}
        onClick={() => onAction(action)}
      >
        {labelFor(action, index, copy, actionLabelOverrides)}
      </button>)}
    </nav> : null}
  </main>;
}
