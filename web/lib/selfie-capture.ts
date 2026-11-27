import type { PoseTarget } from "./poseguard/types";
import { previewCrop } from "./rgbnet";

export type CaptureState = {
  phase: "starting" | "framing" | "holding" | "captured" | "checking" | "pending" | "complete" | "paused" | "error";
  title: string;
  hint: string;
  progress: number;
  cameraReady: boolean;
  target?: PoseTarget | null;
  poseStep?: { index: number; total: number };
};

export const INITIAL_CAPTURE_STATE: CaptureState = {
  phase: "starting", title: "Opening your camera", hint: "Allow camera access when your browser asks.", progress: 0, cameraReady: false,
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
  } else if (name === "AbortError") {
    // An abort message names the internal reason, or is the browser's generic text.
    hint = "Something went wrong. Please try again.";
  }
  return { phase: "error", title, hint, progress: 0, cameraReady: false };
}

/**
 * Copies the part of the current camera frame that the preview shows, which is also the image the framing
 * guidance evaluated. A full landscape frame would leave the face too small for the face engine.
 */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const { videoWidth: width, videoHeight: height } = video;
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error("Camera frame dimensions are unsupported.");
  const [sx, sy, sw, sh] = previewCrop(width, height, video.clientWidth || width, video.clientHeight || height);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the capture canvas.");
  context.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}
