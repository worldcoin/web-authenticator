import {
  isHexSha256,
  validateSimulationCapturePolicyV0,
  type FrameDescriptorV0,
} from "../../contracts/src";
import { assertFrameWithinPolicy, buildFrameBundle, sha256Rgba8 } from "./artifact";
import { reduceCaptureState } from "./state";
import type {
  CaptureFailureCode,
  CaptureInterruptionReason,
  CapturePlatform,
  CaptureRequest,
  CaptureRuntimeOptions,
  CaptureState,
  FrameSampler,
  OwnedMediaStream,
  TransientRgba8Frame,
} from "./types";

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "user" } },
};

const SAFE_MESSAGES: Readonly<Record<CaptureFailureCode, string>> = {
  unsupported_context: "Camera capture is not supported in this context",
  prf_not_ready: "Authentication setup must complete before camera capture",
  user_activation_required: "Camera capture requires a user action",
  permission_denied: "Camera permission was denied or revoked",
  camera_unavailable: "No usable camera is available",
  camera_busy: "The camera is busy or unavailable to this tab",
  camera_restricted: "Camera access is restricted",
  camera_unsupported: "Camera capture is unavailable in this browser",
  non_user_facing_camera: "The selected camera is not user-facing",
  constraints_unsatisfied: "The requested camera constraints are unavailable",
  acquisition_aborted: "Camera acquisition was aborted",
  permission_timeout: "Camera permission did not resolve in time",
  preview_timeout: "The camera did not produce a frame in time",
  preview_invalid_frame: "The camera produced an invalid frame",
  interrupted: "Camera capture was interrupted",
  session_expired: "The capture session expired",
  capture_in_progress: "A camera capture is already in progress",
  artifact_limit: "The captured frame exceeds the metadata policy",
  quality_callback_failed: "The local capture guidance could not inspect the frame",
  unknown: "Camera capture failed",
};

export class CaptureRuntimeError extends Error {
  readonly code: CaptureFailureCode;

  constructor(code: CaptureFailureCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "CaptureRuntimeError";
    this.code = code;
  }
}

interface ActiveAttempt {
  readonly generation: number;
  readonly interrupted: Promise<never>;
  rejectInterruption(error: CaptureRuntimeError): void;
  stream?: OwnedMediaStream;
  sampler?: FrameSampler;
  readonly buffers: Set<Uint8ClampedArray>;
  readonly cleanupCallbacks: Array<() => void>;
  expiryTimer?: unknown;
  terminalError?: CaptureRuntimeError;
  cleaned: boolean;
}

function terminalStateFor(code: CaptureFailureCode): CaptureState {
  switch (code) {
    case "permission_denied":
      return "permission_denied";
    case "camera_unavailable":
    case "camera_unsupported":
    case "non_user_facing_camera":
    case "constraints_unsatisfied":
      return "camera_unavailable";
    case "camera_busy":
      return "camera_busy";
    case "camera_restricted":
      return "camera_restricted";
    case "session_expired":
      return "expired";
    case "interrupted":
    case "acquisition_aborted":
      return "interrupted";
    default:
      return "failed";
  }
}

function classifyCameraError(value: unknown): CaptureRuntimeError {
  let name = "";
  try {
    if (typeof value === "object" && value !== null) {
      name = String((value as { readonly name?: unknown }).name ?? "");
    }
  } catch {
    return new CaptureRuntimeError("unknown");
  }
  switch (name) {
    case "NotAllowedError":
      return new CaptureRuntimeError("permission_denied");
    case "NotFoundError":
      return new CaptureRuntimeError("camera_unavailable");
    case "NotReadableError":
      return new CaptureRuntimeError("camera_busy");
    case "SecurityError":
      return new CaptureRuntimeError("camera_restricted");
    case "OverconstrainedError":
      return new CaptureRuntimeError("constraints_unsatisfied");
    case "AbortError":
      return new CaptureRuntimeError("acquisition_aborted");
    case "NotSupportedError":
      return new CaptureRuntimeError("camera_unsupported");
    default:
      return new CaptureRuntimeError("unknown");
  }
}

function stopStream(stream: OwnedMediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Resource cleanup is best effort and errors never include media data.
    }
  }
}

function assertUserFacingWhenKnown(stream: OwnedMediaStream): void {
  for (const track of stream.getTracks()) {
    let facingMode: string | undefined;
    try {
      facingMode = track.getSettings?.().facingMode;
    } catch {
      // Missing or unreadable settings are unknown observations, not trust signals.
    }
    if (facingMode === "environment" || facingMode === "left" || facingMode === "right") {
      throw new CaptureRuntimeError("non_user_facing_camera");
    }
  }
}

export class MetadataOnlyCaptureRuntime {
  private stateValue: CaptureState = "idle";
  private generation = 0;
  private active?: ActiveAttempt;
  private readonly permissionTimeoutMs: number;
  private readonly firstFrameTimeoutMs: number;

  constructor(
    private readonly platform: CapturePlatform,
    private readonly options: CaptureRuntimeOptions = {},
  ) {
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? 20_000;
    this.firstFrameTimeoutMs = options.firstFrameTimeoutMs ?? 8_000;
  }

  get state(): CaptureState {
    return this.stateValue;
  }

  async capture(request: CaptureRequest) {
    if (this.active !== undefined) throw new CaptureRuntimeError("capture_in_progress");
    const admissionError = this.validateRequest(request);
    if (admissionError !== undefined) {
      this.transition(terminalStateFor(admissionError.code));
      this.transition("cleaning_up");
      this.transition("complete");
      throw admissionError;
    }

    let rejectInterruption!: (error: CaptureRuntimeError) => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
    });
    // A handler is attached immediately so a synchronous cancel cannot create an unhandled rejection.
    void interrupted.catch(() => undefined);
    const attempt: ActiveAttempt = {
      generation: ++this.generation,
      interrupted,
      rejectInterruption,
      buffers: new Set(),
      cleanupCallbacks: [],
      cleaned: false,
    };
    this.active = attempt;

    try {
      this.transition("permission_request");
      const unsubscribe = this.platform.subscribeInterruptions((reason) =>
        this.interruptAttempt(attempt, reason),
      );
      if (attempt.cleaned) unsubscribe();
      else attempt.cleanupCallbacks.push(unsubscribe);
      if (attempt.terminalError !== undefined) throw attempt.terminalError;
      const expiresInMs = Date.parse(request.policy.expiresAt) - this.platform.nowEpochMs();
      attempt.expiryTimer = this.platform.setTimer(
        () => this.interruptAttempt(attempt, "session_expired"),
        Math.max(0, expiresInMs),
      );

      const pendingStream = this.platform.requestCamera(CAMERA_CONSTRAINTS);
      // getUserMedia has no abort signal. A stale late stream is disposed before use.
      const guardedStream = pendingStream.then(
        (stream) => {
          if (this.active !== attempt || attempt.terminalError !== undefined || attempt.cleaned) {
            stopStream(stream);
            throw attempt.terminalError ?? new CaptureRuntimeError("interrupted");
          }
          return stream;
        },
        (error: unknown) => {
          throw classifyCameraError(error);
        },
      );
      attempt.stream = await this.raceAttempt(
        attempt,
        this.withTimeout(guardedStream, this.permissionTimeoutMs, "permission_timeout"),
      );
      this.bindTrackInterruptions(attempt);
      this.transition("acquiring");
      assertUserFacingWhenKnown(attempt.stream);

      attempt.sampler = this.platform.createSampler(attempt.stream);
      attempt.sampler.setInterruptionListener?.((reason) =>
        this.interruptAttempt(attempt, reason),
      );
      this.transition("awaiting_first_frame");
      await this.raceAttempt(
        attempt,
        this.withTimeout(
          attempt.sampler.prepare(request.policy),
          this.firstFrameTimeoutMs,
          "preview_timeout",
          "preview_invalid_frame",
        ),
      );
      this.transition("preview");
      this.transition("sampling");

      const captureStartedAt = this.platform.nowMonotonicMs();
      const targetCount = request.frameCount ?? request.policy.minFrames;
      const descriptors: FrameDescriptorV0[] = [];
      let totalByteLength = 0;
      for (let transportIndex = 0; transportIndex < targetCount; transportIndex += 1) {
        const pendingFrame = attempt.sampler.sample(request.policy).then((frame) => {
          if (this.active !== attempt || attempt.terminalError !== undefined || attempt.cleaned) {
            frame.bytes.fill(0);
            attempt.sampler?.clear();
            throw attempt.terminalError ?? new CaptureRuntimeError("interrupted");
          }
          return frame;
        });
        const frame = await this.raceAttempt(attempt, pendingFrame);
        attempt.buffers.add(frame.bytes);
        try {
          assertFrameWithinPolicy(frame, request.policy);
          totalByteLength += frame.bytes.byteLength;
          if (totalByteLength > request.policy.maxTotalBytes) {
            throw new CaptureRuntimeError("artifact_limit");
          }
          const frameDigestSha256 = await this.raceAttempt(attempt, sha256Rgba8(frame));
          if (request.inspectTransientFrame !== undefined) {
            try {
              await this.raceAttempt(attempt, Promise.resolve(request.inspectTransientFrame(frame)));
            } catch {
              if (attempt.terminalError !== undefined) throw attempt.terminalError;
              throw new CaptureRuntimeError("quality_callback_failed");
            }
          }
          const offset = Math.trunc(this.platform.nowMonotonicMs() - captureStartedAt);
          if (!Number.isSafeInteger(offset)) throw new CaptureRuntimeError("artifact_limit");
          descriptors.push({
            transportIndex,
            width: frame.width,
            height: frame.height,
            encoding: "rgba8",
            byteLength: frame.bytes.byteLength,
            frameDigestSha256,
            captureOffsetMs: Math.max(0, offset),
          });
        } catch (error) {
          if (error instanceof CaptureRuntimeError) throw error;
          if (error instanceof RangeError) throw new CaptureRuntimeError("artifact_limit");
          throw new CaptureRuntimeError("preview_invalid_frame");
        } finally {
          frame.bytes.fill(0);
          attempt.buffers.delete(frame.bytes);
          attempt.sampler.clear();
        }
      }

      const bundle = await this.raceAttempt(
        attempt,
        buildFrameBundle({
          sessionId: request.sessionId,
          policy: request.policy,
          accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
          nonceDigestSha256: request.nonceDigestSha256,
          frames: descriptors,
        }),
      );
      this.transition("artifact_ready");
      this.finishAttempt(attempt);
      return bundle;
    } catch (error) {
      const safeError =
        attempt.terminalError ??
        (error instanceof CaptureRuntimeError ? error : classifyCameraError(error));
      if (!attempt.cleaned) {
        this.transition(terminalStateFor(safeError.code));
        this.finishAttempt(attempt);
      }
      throw safeError;
    }
  }

  cancel(): void {
    if (this.active !== undefined) this.interruptAttempt(this.active, "cancel");
  }

  unmount(): void {
    if (this.active !== undefined) this.interruptAttempt(this.active, "unmount");
  }

  private validateRequest(request: CaptureRequest): CaptureRuntimeError | undefined {
    if (!request.entry.userActivated) return new CaptureRuntimeError("user_activation_required");
    if (
      !request.entry.secureTopLevelContextApproved ||
      !Number.isSafeInteger(request.entry.iosMajor) ||
      request.entry.iosMajor < 18 ||
      (request.entry.browser !== "safari" && request.entry.browser !== "chrome")
    ) {
      return new CaptureRuntimeError("unsupported_context");
    }
    if (!request.entry.prfReady) return new CaptureRuntimeError("prf_not_ready");
    if (
      request.policy.dataMode !== "metadata_only" ||
      validateSimulationCapturePolicyV0(request.policy).length > 0
    ) {
      return new CaptureRuntimeError("artifact_limit");
    }
    const expiresAt = Date.parse(request.policy.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.platform.nowEpochMs()) {
      return new CaptureRuntimeError("session_expired");
    }
    const integerLimits = [
      request.policy.minFrames,
      request.policy.maxFrames,
      request.policy.maxWidth,
      request.policy.maxHeight,
      request.policy.maxFrameBytes,
      request.policy.maxTotalBytes,
    ];
    if (
      integerLimits.some((value) => !Number.isSafeInteger(value)) ||
      request.policy.maxFrameBytes < 4 ||
      request.policy.maxTotalBytes < request.policy.minFrames * 4
    ) {
      return new CaptureRuntimeError("artifact_limit");
    }
    if (
      !request.sessionId ||
      !isHexSha256(request.accountPublicMaterialDigestSha256) ||
      !isHexSha256(request.nonceDigestSha256)
    ) {
      return new CaptureRuntimeError("artifact_limit");
    }
    const frameCount = request.frameCount ?? request.policy.minFrames;
    if (
      !Number.isSafeInteger(frameCount) ||
      frameCount < request.policy.minFrames ||
      frameCount > request.policy.maxFrames
    ) {
      return new CaptureRuntimeError("artifact_limit");
    }
    return undefined;
  }

  private raceAttempt<T>(attempt: ActiveAttempt, operation: Promise<T>): Promise<T> {
    return Promise.race([operation, attempt.interrupted]);
  }

  private withTimeout<T>(
    operation: Promise<T>,
    delayMs: number,
    timeoutCode: CaptureFailureCode,
    rejectionCode?: CaptureFailureCode,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.platform.setTimer(
        () => reject(new CaptureRuntimeError(timeoutCode)),
        delayMs,
      );
      operation.then(
        (value) => {
          this.platform.clearTimer(timer);
          resolve(value);
        },
        (error: unknown) => {
          this.platform.clearTimer(timer);
          if (rejectionCode !== undefined) reject(new CaptureRuntimeError(rejectionCode));
          else if (error instanceof CaptureRuntimeError) reject(error);
          else reject(new CaptureRuntimeError("unknown"));
        },
      );
    });
  }

  private bindTrackInterruptions(attempt: ActiveAttempt): void {
    if (attempt.stream === undefined) return;
    for (const track of attempt.stream.getTracks()) {
      const muted = () => this.interruptAttempt(attempt, "track_muted");
      const ended = () => this.interruptAttempt(attempt, "track_ended");
      track.addEventListener?.("mute", muted);
      track.addEventListener?.("ended", ended);
      attempt.cleanupCallbacks.push(() => {
        track.removeEventListener?.("mute", muted);
        track.removeEventListener?.("ended", ended);
      });
    }
  }

  private interruptAttempt(attempt: ActiveAttempt, reason: CaptureInterruptionReason): void {
    if (this.active !== attempt || attempt.cleaned) return;
    const error = new CaptureRuntimeError(
      reason === "session_expired" ? "session_expired" : "interrupted",
    );
    attempt.terminalError = error;
    this.transition(reason === "session_expired" ? "expired" : "interrupted");
    this.finishAttempt(attempt);
    attempt.rejectInterruption(error);
  }

  private finishAttempt(attempt: ActiveAttempt): void {
    if (attempt.cleaned) return;
    attempt.cleaned = true;
    this.transition("cleaning_up");
    if (attempt.expiryTimer !== undefined) this.platform.clearTimer(attempt.expiryTimer);
    for (const callback of attempt.cleanupCallbacks.splice(0)) {
      try {
        callback();
      } catch {
        // Cleanup remains best effort and emits no underlying object.
      }
    }
    for (const buffer of attempt.buffers) buffer.fill(0);
    attempt.buffers.clear();
    try {
      attempt.sampler?.clear();
    } catch {
      // Canvas clearing remains best effort.
    }
    try {
      attempt.sampler?.dispose();
    } catch {
      // Preview detachment remains best effort.
    }
    if (attempt.stream !== undefined) stopStream(attempt.stream);
    if (this.active === attempt) this.active = undefined;
    this.transition("complete");
  }

  private transition(next: CaptureState): void {
    this.stateValue = reduceCaptureState(this.stateValue, next);
    try {
      this.options.onStateChange?.(next);
    } catch {
      // Observers are metadata-only and cannot prevent resource cleanup.
    }
  }
}
