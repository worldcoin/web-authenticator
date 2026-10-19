// Capture settings from world-app-ios FaceAuthLightGuardConfig+Default.swift.
// Model YAML and authentication/retry policy are deliberately not browser policy.
export const CAMERA_CAPTURE_CONFIG = {
  timeoutMs: 30_000,
  processingDelayMs: 2_000,
  illuminated: { background: "#FFFFFF", foreground: "#000000", frames: 2 },
  unilluminated: { background: "#000000", foreground: "#FFFFFF", frames: 10 },
  transitionMarginMs: 99,
} as const;

export type CapturePhase = "illuminated" | "unilluminated";
export type CapturedFrame = {
  phase: CapturePhase;
  canvas: HTMLCanvasElement;
  mediaTime: number;
  presentedFrames: number;
  callbackTimeMs: number;
  captureTimeMs: number | null;
  phaseReadyTimeMs: number;
};

export function withCaptureAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Capture cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Local capture experiment; callback timing cannot establish native exposure timing. */
export async function captureCameraFrames(
  video: HTMLVideoElement,
  lightGuard: boolean,
  signal: AbortSignal,
  showPhase: (phase: CapturePhase) => void,
): Promise<CapturedFrame[]> {
  if (typeof video.requestVideoFrameCallback !== "function") {
    throw new Error("This browser does not support video frame callbacks.");
  }
  const frames: CapturedFrame[] = [];
  let lastPresentedFrame = -1;
  let animationId: number | undefined;
  let videoId: number | undefined;
  const cancelCallbacks = () => {
    if (animationId !== undefined) cancelAnimationFrame(animationId);
    if (videoId !== undefined) video.cancelVideoFrameCallback(videoId);
  };
  signal.addEventListener("abort", cancelCallbacks, { once: true });
  try {
    const phases: CapturePhase[] = lightGuard ? ["illuminated", "unilluminated"] : ["illuminated"];
    for (const phase of phases) {
      signal.throwIfAborted();
      showPhase(phase);
      // Allow a paint before counting camera frames. This is not a hardware presentation timestamp.
      const phaseReadyTimeMs = await withCaptureAbort(new Promise<number>(resolve => {
        animationId = requestAnimationFrame(() => {
          animationId = requestAnimationFrame(resolve);
        });
      }), signal);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the capture canvas.");
      const selected: CapturedFrame = {
        phase, canvas, mediaTime: 0, presentedFrames: 0, callbackTimeMs: 0, captureTimeMs: null, phaseReadyTimeMs,
      };
      frames.push(selected);
      const requiredFrames = lightGuard ? CAMERA_CAPTURE_CONFIG[phase].frames : 1;
      await withCaptureAbort(new Promise<void>((resolve, reject) => {
        let count = 0;
        const next: VideoFrameRequestCallback = (now, metadata) => {
          try {
            signal.throwIfAborted();
            const capturedAt = Number.isFinite(metadata.captureTime) ? metadata.captureTime : null;
            // Use capture time where exposed. The fallback is only a candidate-frame heuristic.
            const frameTime = capturedAt ?? now;
            // WebKit can report mediaTime=0 for successive live-stream frames.
            if (metadata.presentedFrames > lastPresentedFrame && frameTime >= phaseReadyTimeMs + CAMERA_CAPTURE_CONFIG.transitionMarginMs) {
              lastPresentedFrame = metadata.presentedFrames;
              count++;
              // Match native selection intent: last illuminated, first unilluminated.
              if (phase === "illuminated" || count === 1) {
                if (video.videoWidth < 1 || video.videoHeight < 1 || video.videoWidth > 4096 || video.videoHeight > 4096) throw new Error("Camera frame dimensions are unsupported.");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0);
                Object.assign(selected, { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames, callbackTimeMs: now, captureTimeMs: capturedAt });
              }
            }
            if (count >= requiredFrames) resolve();
            else videoId = video.requestVideoFrameCallback(next);
          } catch (error) { reject(error); }
        };
        videoId = video.requestVideoFrameCallback(next);
      }), signal);
    }
    return frames;
  } catch (error) {
    for (const frame of frames) frame.canvas.width = frame.canvas.height = 0;
    throw error;
  } finally {
    cancelCallbacks();
    signal.removeEventListener("abort", cancelCallbacks);
  }
}
