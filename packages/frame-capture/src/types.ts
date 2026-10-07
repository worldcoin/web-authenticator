import type {
  FrameBundleV0,
  HexSha256,
  SimulationCapturePolicyV0,
} from "../../contracts/src";

export const CAPTURE_STATES = [
  "idle",
  "permission_request",
  "permission_denied",
  "camera_unavailable",
  "camera_busy",
  "camera_restricted",
  "acquiring",
  "awaiting_first_frame",
  "preview",
  "sampling",
  "artifact_ready",
  "interrupted",
  "expired",
  "failed",
  "cleaning_up",
  "complete",
] as const;

export type CaptureState = (typeof CAPTURE_STATES)[number];

export type CaptureFailureCode =
  | "unsupported_context"
  | "prf_not_ready"
  | "user_activation_required"
  | "permission_denied"
  | "camera_unavailable"
  | "camera_busy"
  | "camera_restricted"
  | "camera_unsupported"
  | "non_user_facing_camera"
  | "constraints_unsatisfied"
  | "acquisition_aborted"
  | "permission_timeout"
  | "preview_timeout"
  | "preview_invalid_frame"
  | "interrupted"
  | "session_expired"
  | "capture_in_progress"
  | "artifact_limit"
  | "quality_callback_failed"
  | "unknown";

export type CaptureInterruptionReason =
  | "cancel"
  | "visibility_hidden"
  | "pagehide"
  | "beforeunload"
  | "orientation_change"
  | "track_muted"
  | "track_ended"
  | "session_expired"
  | "unmount";

/** W02/W03-owned results must be supplied, not recomputed from the user agent here. */
export interface ApprovedCaptureEntry {
  readonly userActivated: boolean;
  readonly secureTopLevelContextApproved: boolean;
  readonly prfReady: boolean;
  readonly iosMajor: number;
  readonly browser: "safari" | "chrome";
}

export interface CaptureRequest {
  readonly entry: ApprovedCaptureEntry;
  readonly policy: SimulationCapturePolicyV0;
  readonly sessionId: string;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly nonceDigestSha256: HexSha256;
  readonly frameCount?: number;
  /** Runs synchronously in the capture lifecycle. The bytes are cleared after it returns. */
  readonly inspectTransientFrame?: TransientFrameInspector;
}

export interface TransientRgba8Frame {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8ClampedArray;
}

export type TransientFrameInspector = (
  frame: Readonly<TransientRgba8Frame>,
) => void | Promise<void>;

export interface OwnedMediaTrack {
  stop(): void;
  getSettings?(): { readonly facingMode?: string };
  addEventListener?(type: "mute" | "ended", listener: () => void): void;
  removeEventListener?(type: "mute" | "ended", listener: () => void): void;
}

export interface OwnedMediaStream {
  getTracks(): readonly OwnedMediaTrack[];
}

export interface FrameSampler {
  prepare(policy: SimulationCapturePolicyV0): Promise<void>;
  sample(policy: SimulationCapturePolicyV0): Promise<TransientRgba8Frame>;
  setInterruptionListener?(listener: (reason: CaptureInterruptionReason) => void): void;
  clear(): void;
  dispose(): void;
}

export interface CapturePlatform {
  requestCamera(constraints: MediaStreamConstraints): Promise<OwnedMediaStream>;
  createSampler(stream: OwnedMediaStream): FrameSampler;
  subscribeInterruptions(listener: (reason: CaptureInterruptionReason) => void): () => void;
  nowMonotonicMs(): number;
  nowEpochMs(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface CaptureRuntimeOptions {
  readonly permissionTimeoutMs?: number;
  readonly firstFrameTimeoutMs?: number;
  readonly onStateChange?: (state: CaptureState) => void;
}

export interface SyntheticFixtureRequest {
  readonly testMode: true;
  readonly fixtureId: string;
  readonly policy: SimulationCapturePolicyV0;
  readonly sessionId: string;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly nonceDigestSha256: HexSha256;
  readonly frames: readonly {
    readonly width: number;
    readonly height: number;
    readonly byteLength: number;
    readonly frameDigestSha256: HexSha256;
    readonly captureOffsetMs?: number;
  }[];
}

export type CaptureArtifact = FrameBundleV0;
