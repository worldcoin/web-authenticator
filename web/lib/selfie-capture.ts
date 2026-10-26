import { startFaceDetector } from "./face-detector";
import { CAPTURE_HOLD_DURATION_MS_V1 } from "./hold-steady-progress";
import { faceGuidance } from "./rgbnet";
import { analytics, analyticsReason } from "./analytics";

/** Local capture only: one frame, taken once the face has held still in the oval. Nothing is uploaded. */
export const CAPTURE_TIMEOUT_MS = 30_000;

export type CaptureState = {
  phase: "starting" | "framing" | "holding" | "capturing" | "complete" | "paused" | "error";
  title: string;
  hint: string;
  progress: number;
  cameraReady: boolean;
};

export type CaptureResult = {
  image: Blob;
  timing: { guidanceMs: number; totalMs: number; width: number; height: number };
};

export const INITIAL_CAPTURE_STATE: CaptureState = {
  phase: "starting", title: "Opening your camera", hint: "Allow camera access when your browser asks.", progress: 0, cameraReady: false,
};

const framingMessages: Record<string, [string, string]> = {
  "No face detected": ["Let's see you", "Position your face in the oval. No need to tap anything."],
  "Keep only one face in view": ["Just you in the frame", "Make sure no one else is in view."],
  "Center your face": ["A little more to the center", "Bring your face into the middle of the oval."],
  "Move closer": ["Come a little closer", "Fill the oval with your face."],
  "Move farther away": ["Move back a little", "Leave a little space around your face."],
};

export function captureFailure(error: unknown): CaptureState {
  const name = error instanceof Error ? error.name : "";
  let title = "We couldn't finish your selfie";
  let hint = error instanceof Error ? error.message : "Something went wrong. Please try again.";
  if (name === "NotAllowedError" || name === "SecurityError") {
    title = "Allow camera access";
    hint = "Enable the camera in your browser's site settings, then try again.";
  } else if (name === "NotFoundError" || name === "OverconstrainedError") {
    title = "We couldn't find a camera";
    hint = "Open this page on a phone or a device with a camera.";
  } else if (name === "NotReadableError") {
    title = "Your camera is busy";
    hint = "Close any other app using the camera, then try again.";
  } else if (name === "TimeoutError") {
    title = "Let's give that another try";
    hint = "The check took too long. Find good light and try again.";
  }
  return { phase: "error", title, hint, progress: 0, cameraReady: false };
}

/** Rejects as soon as `signal` aborts, even if `promise` never settles. */
export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Capture cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Copies the current camera frame. The detector has just confirmed the framing. */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const { videoWidth: width, videoHeight: height } = video;
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error("Camera frame dimensions are unsupported.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the capture canvas.");
  context.drawImage(video, 0, 0);
  return canvas;
}

/** Owns one attempt. A retained live preview must be released by aborting the caller’s signal. */
export async function captureSelfie(video: HTMLVideoElement, signal: AbortSignal, update: (state: CaptureState) => void, options: { retainPreviewUntilAbort?: boolean } = {}): Promise<CaptureResult> {
  const captureFinished = analytics.begin("selfie_capture");
  const cameraFinished = analytics.begin("camera");
  let guidanceFinished: ReturnType<typeof analytics.begin> | undefined;
  let challengeFinished: ReturnType<typeof analytics.begin> | undefined;
  let stream: MediaStream | undefined;
  let stopDetector: (() => void) | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let previewRetained = false;
  let stopHoldProgress: (() => void) | undefined;
  const started = performance.now();
  const releaseCamera = () => {
    signal.removeEventListener("abort", releaseCamera);
    stopHoldProgress?.();
    stopDetector?.();
    stopDetector = undefined;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    video.srcObject = null;
  };
  signal.addEventListener("abort", releaseCamera, { once: true });
  try {
    signal.throwIfAborted();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open this page in a browser with camera access over HTTPS or localhost.");
    const media = await withAbort<MediaStream>(navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    }).then(media => {
      // A stream granted after cancellation must still be stopped.
      if (signal.aborted) {
        media.getTracks().forEach(track => track.stop());
        signal.throwIfAborted();
      }
      return media;
    }), signal);
    stream = media;
    video.srcObject = media;
    const disconnected = new AbortController();
    for (const track of media.getVideoTracks()) {
      track.addEventListener("ended", () => disconnected.abort(new Error("Your camera disconnected. Check the connection, then try again.")), { once: true });
    }
    const attempt = AbortSignal.any([signal, disconnected.signal]);
    attempt.addEventListener("abort", releaseCamera, { once: true });
    try {
      await withAbort(video.play(), attempt);
      cameraFinished("completed");
      guidanceFinished = analytics.begin("face_guidance");
      update({ phase: "framing", title: "Find your light", hint: "Look at the camera. We're getting ready.", progress: 0, cameraReady: true });
      await withAbort(new Promise<void>((resolve, reject) => {
        let alignedSince: number | undefined;
        let lastResultAt = 0;
        let progressFrame: number | undefined;
        stopHoldProgress = () => {
          if (progressFrame !== undefined) cancelAnimationFrame(progressFrame);
          progressFrame = undefined;
        };
        const showHoldProgress = () => {
          progressFrame = undefined;
          if (attempt.aborted || alignedSince === undefined) return;
          const now = performance.now();
          if (now - lastResultAt > 1_500) { alignedSince = undefined; return; }
          const progress = Math.min(1, (now - alignedSince) / CAPTURE_HOLD_DURATION_MS_V1);
          update({ phase: "holding", title: "Looking good. Hold still", hint: "Just a moment. Your selfie is taken automatically.", progress, cameraReady: true });
          if (progress < 1) progressFrame = requestAnimationFrame(showHoldProgress);
        };
        stopDetector = startFaceDetector(video, attempt, false, (faces, width, height) => {
          if (attempt.aborted) return;
          const message = faceGuidance(faces, width, height, video.clientWidth, video.clientHeight);
          const now = performance.now();
          // A gap in inference cannot count as continuously observed good framing.
          if (now - lastResultAt > 1_500) alignedSince = undefined;
          lastResultAt = now;
          if (message === "Face positioned") {
            guidanceFinished?.("completed");
            challengeFinished ??= analytics.begin("physical_challenge");
            alignedSince ??= now;
            if (progressFrame === undefined) showHoldProgress();
            // Only a fresh, aligned detector result can complete the hold.
            if (now - alignedSince >= CAPTURE_HOLD_DURATION_MS_V1) resolve();
          } else {
            alignedSince = undefined;
            stopHoldProgress?.();
            const [title, hint] = framingMessages[message] ?? ["Getting your camera ready", "Look at the camera and keep your face in the oval."];
            update({ phase: "framing", title, hint, progress: 0, cameraReady: true });
          }
        }, () => { /* Routine detector diagnostics are omitted; failures reject below. */ }, failure => reject(new Error(`Face guidance couldn't start. ${failure}`)));
      }), attempt);
      const alignedAt = performance.now();
      challengeFinished?.("completed");
      stopHoldProgress?.();
      stopDetector?.(); stopDetector = undefined;
      update({ phase: "capturing", title: "Looking good. Hold still", hint: "Just a moment. Your selfie is taken automatically.", progress: 1, cameraReady: true });
      canvas = grabFrame(video);
      const frame = canvas;
      const image = await withAbort(new Promise<Blob>((resolve, reject) => {
        frame.toBlob(value => value ? resolve(value) : reject(new Error("We couldn't save this capture in memory. Please try again.")), "image/jpeg", 0.9);
      }), attempt);
      previewRetained = options.retainPreviewUntilAbort === true;
      captureFinished("completed");
      return {
        image,
        timing: { guidanceMs: Math.round(alignedAt - started), totalMs: Math.round(performance.now() - started), width: frame.width, height: frame.height },
      };
    } finally {
      attempt.removeEventListener("abort", releaseCamera);
    }
  } catch (error) {
    const reason = analyticsReason(error);
    const status = reason === "cancelled" ? "cancelled" : "failed";
    cameraFinished(status, reason); guidanceFinished?.(status, reason);
    challengeFinished?.(status, reason); captureFinished(status, reason);
    throw error;
  } finally {
    if (!previewRetained) releaseCamera();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
