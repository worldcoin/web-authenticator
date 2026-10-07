import type { AuthenticatorUiStateIdV1 } from "@clean-start/contracts";
import type {
  LivePasskeyStatusV1,
  LivePrfCapabilityV1,
} from "../walkthrough/live-passkey";
import type { WalkthroughCameraStatusV1 } from "../walkthrough/walkthrough-adapters";

export interface WalkthroughPanelPropsV1 {
  readonly state: AuthenticatorUiStateIdV1;
  readonly passkeyStatus: LivePasskeyStatusV1;
  readonly prfCapability: LivePrfCapabilityV1;
  readonly cameraStatus: WalkthroughCameraStatusV1;
  readonly onRestart: () => void;
}

function stepFor(state: AuthenticatorUiStateIdV1): number {
  if (state.startsWith("request_")) return 1;
  if (state.startsWith("admission_")) return 2;
  if (state.startsWith("demo_authenticator_") || state === "session_creating") return 3;
  if (state.startsWith("capture_") || state === "session_completing_authenticator") return 4;
  if (
    state.startsWith("biometric_") ||
    state.startsWith("issuance_") ||
    state === "session_reconciling" ||
    state === "session_error"
  ) return 5;
  return 6;
}

const PASSKEY_LABELS: Readonly<Record<LivePasskeyStatusV1, string>> = Object.freeze({
  idle: "Ready to try",
  requesting: "Browser prompt open",
  created: "Created by browser",
  unsupported: "Unavailable · simulator continued",
  cancelled: "Not completed · simulator continued",
  failed: "Failed safely · simulator continued",
});

const CAMERA_LABELS: Readonly<Record<WalkthroughCameraStatusV1, string>> = Object.freeze({
  idle: "Waiting",
  requesting: "Requesting browser camera",
  live: "Live camera + on-device guidance",
  synthetic_fallback: "Synthetic metadata fallback",
  live_complete: "Live metadata submitted",
  synthetic_complete: "Synthetic metadata submitted",
  failed: "Stopped safely",
});

export function WalkthroughPanelV1(props: WalkthroughPanelPropsV1) {
  return <aside className="walkthrough-panel" aria-label="Local demo status">
    <div className="walkthrough-panel__header">
      <p className="walkthrough-eyebrow">Local walkthrough</p>
      <p className="walkthrough-step">Step {stepFor(props.state)} of 6</p>
    </div>
    <h2>What is live?</h2>
    <dl className="walkthrough-status-list" aria-live="polite">
      <div>
        <dt>iPhone admission</dt>
        <dd data-walkthrough-status="simulated">Bypassed for localhost</dd>
      </div>
      <div>
        <dt>Passkey</dt>
        <dd data-walkthrough-passkey={props.passkeyStatus}>
          {PASSKEY_LABELS[props.passkeyStatus]}
        </dd>
      </div>
      <div>
        <dt>PRF capability</dt>
        <dd>{props.prfCapability === "available"
          ? "Reported available"
          : props.prfCapability === "unavailable"
            ? "Not reported"
            : "Not checked"}</dd>
      </div>
      <div>
        <dt>Camera</dt>
        <dd data-walkthrough-camera={props.cameraStatus}>
          {CAMERA_LABELS[props.cameraStatus]}
        </dd>
      </div>
      <div>
        <dt>Biometric + issuance</dt>
        <dd data-walkthrough-status="simulated">Local server simulators</dd>
      </div>
    </dl>
    <p className="walkthrough-warning">
      A live passkey can remain in your password manager. It is not registered
      to World ID. No PRF output, World ID key, or camera pixels are retained.
    </p>
    <button type="button" className="walkthrough-restart" onClick={props.onRestart}>
      Restart walkthrough
    </button>
    <a className="walkthrough-production-link" href="/">Open production-gated route</a>
  </aside>;
}
