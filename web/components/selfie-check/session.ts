import { startFaceDetector } from "../../lib/face-detector";
import { CAPTURE_HOLD_DURATION_MS_V1 } from "../../lib/hold-steady-progress";
import { faceGuidance } from "../../lib/rgbnet";
import { CAMERA_CAPTURE_CONFIG, captureCameraFrames, withCaptureAbort, type CapturedFrame, type CapturePhase } from "./capture";

export type CaptureState = {
  phase: "starting" | "framing" | "holding" | "capturing" | "complete" | "paused" | "error";
  title: string;
  hint: string;
  progress: number;
  cameraReady: boolean;
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

/** Owns one attempt. The caller owns returned blobs; camera/worker/canvas cleanup is unconditional. */
export async function captureSelfie(
  video: HTMLVideoElement,
  lightGuard: boolean,
  signal: AbortSignal,
  update: (state: CaptureState) => void,
  showPhase: (phase?: CapturePhase) => void,
) {
  let stream: MediaStream | undefined;
  let stopDetector: (() => void) | undefined;
  let frames: CapturedFrame[] = [];
  const started = performance.now();
  const releaseCamera = () => {
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
    const media = await withCaptureAbort<MediaStream>(navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    }).then(media => {
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
    // Disconnects also interrupt a pending inference, frame callback, or image encoding.
    attempt.addEventListener("abort", releaseCamera, { once: true });
    try {
      await withCaptureAbort(video.play(), attempt);
      const cameraReadyAt = performance.now();
      update({ phase: "framing", title: "Find your light", hint: "Look at the camera. We're getting ready.", progress: 0, cameraReady: true });
      await withCaptureAbort(new Promise<void>((resolve, reject) => {
        let alignedSince: number | undefined;
        let lastResultAt = 0;
        stopDetector = startFaceDetector(video, attempt, false, (faces, width, height) => {
          if (attempt.aborted) return;
          const message = faceGuidance(faces, width, height, video.clientWidth, video.clientHeight);
          const now = performance.now();
          // A gap in inference cannot count as continuously observed good framing.
          if (now - lastResultAt > 1_500) alignedSince = undefined;
          lastResultAt = now;
          if (message === "Face positioned") {
            alignedSince ??= now;
            const progress = Math.min(1, (now - alignedSince) / CAPTURE_HOLD_DURATION_MS_V1);
            update({ phase: "holding", title: "Looking good. Hold still", hint: "Just a moment. Your selfie is taken automatically.", progress, cameraReady: true });
            if (progress === 1 && now - cameraReadyAt >= CAMERA_CAPTURE_CONFIG.processingDelayMs) resolve();
          } else {
            alignedSince = undefined;
            const [title, hint] = framingMessages[message] ?? ["Getting your camera ready", "Look at the camera and keep your face in the oval."];
            update({ phase: "framing", title, hint, progress: 0, cameraReady: true });
          }
        }, () => { /* Routine detector diagnostics are omitted; failures reject below. */ }, failure => reject(new Error(`Face guidance couldn't start. ${failure}`)));
      }), attempt);
      stopDetector?.();
      stopDetector = undefined;
      const alignedAt = performance.now();
      frames = await captureCameraFrames(video, lightGuard, attempt, phase => {
        if (lightGuard) showPhase(phase);
        update({ phase: "capturing", title: "Perfect. Stay right there", hint: "Finishing your selfie…", progress: 1, cameraReady: true });
      });
      const capturedAt = performance.now();
      releaseCamera();
      showPhase();
      const images = [];
      for (const frame of frames) {
        const blob = await withCaptureAbort(new Promise<Blob>((resolve, reject) => {
          frame.canvas.toBlob(value => value ? resolve(value) : reject(new Error("We couldn't save this capture in memory. Please try again.")), "image/jpeg", 0.9);
        }), attempt);
        attempt.throwIfAborted();
        images.push({ phase: frame.phase, blob });
      }
      return {
        images,
        timing: {
          guidanceMs: Math.round(alignedAt - started), captureMs: Math.round(capturedAt - alignedAt), totalMs: Math.round(performance.now() - started),
          frames: frames.map(({ canvas, ...metadata }) => ({ ...metadata, width: canvas.width, height: canvas.height })),
        },
      };
    } finally {
      attempt.removeEventListener("abort", releaseCamera);
    }
  } finally {
    signal.removeEventListener("abort", releaseCamera);
    releaseCamera();
    for (const frame of frames) frame.canvas.width = frame.canvas.height = 0;
  }
}
