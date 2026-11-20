import { abortable, pause } from "../async";
import { CAPTURE_HOLD_DURATION_MS_V1 } from "../hold-steady-progress";
import { grabFrame, type CaptureState } from "../selfie-capture";
import type { PoseGuardImages, PoseGuardPrompt, PoseObservation, PoseTarget } from "./types";
import { openPoseDetector } from "./worker";

const CHALLENGE_TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SAMPLE_GAP_MS = 1_000;
const DIRECTIONS = ["right", "up and right", "up", "up and left", "left", "down and left", "down", "down and right"];

export interface PoseFrame {
  timestamp: number;
  pose: PoseObservation | null;
  png(signal: AbortSignal): Promise<Uint8Array>;
  release(): void;
}

export function poseDirection(target: PoseTarget): { degrees: number; label: string } {
  // The preview mirrors yaw. Inference and the capture use the unmirrored image.
  const degrees = (Math.atan2(target.targetPitch, -target.targetYaw) * 180 / Math.PI + 360) % 360;
  return { degrees, label: DIRECTIONS[Math.round(degrees / 45) % 8] };
}

export async function preparePoseGuardCamera(video: HTMLVideoElement, signal: AbortSignal, update: (state: CaptureState) => void) {
  const controller = new AbortController();
  const active = AbortSignal.any([signal, controller.signal]);
  let stream: MediaStream | undefined;
  const release = () => {
    active.removeEventListener("abort", release);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
    }
  };
  const close = () => controller.abort();
  active.addEventListener("abort", release, { once: true });
  try {
    active.throwIfAborted();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open this page in a browser with camera access over HTTPS or localhost.");
    const [detector] = await Promise.all([
      openPoseDetector(active),
      abortable(navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      }).then(async media => {
        if (active.aborted) {
          media.getTracks().forEach(track => track.stop());
          active.throwIfAborted();
        }
        stream = media;
        video.srcObject = media;
        for (const track of media.getVideoTracks()) {
          track.addEventListener("ended", () => controller.abort(new Error("Your camera disconnected. Try again.")), { once: true });
        }
        await abortable(video.play(), active);
        update({ phase: "framing", title: "Preparing your selfie check", hint: "Keep your face in the oval.", progress: 0, cameraReady: true });
      }), active),
    ]);
    let lastVideoTime = -1;
    return {
      close,
      signal: active,
      async readFrame(signal: AbortSignal): Promise<PoseFrame> {
        while (video.readyState < 2 || video.currentTime === lastVideoTime) await pause(75, signal);
        signal.throwIfAborted();
        lastVideoTime = video.currentTime;
        const timestamp = performance.now();
        const frame = grabFrame(video);
        const clear = () => { frame.width = frame.height = 0; };
        try {
          const bitmap = await abortable(createImageBitmap(frame).then(bitmap => {
            if (signal.aborted) { bitmap.close(); signal.throwIfAborted(); }
            return bitmap;
          }), signal);
          const observed = await abortable(detector.analyze(bitmap, timestamp), signal);
          return {
            timestamp,
            pose: performance.now() - timestamp > SAMPLE_GAP_MS ? null : observed,
            png: signal => encodePng(frame, signal),
            release: clear,
          };
        } catch (error) {
          clear();
          throw error;
        }
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

export async function collectPoseGuardImages(
  prompt: PoseGuardPrompt,
  signal: AbortSignal,
  readFrame: (signal: AbortSignal) => Promise<PoseFrame>,
  update: (state: CaptureState) => void,
): Promise<PoseGuardImages> {
  if (!Array.isArray(prompt.targets) || prompt.targets.length !== 3 || !prompt.targets.every(target =>
    target && Number.isFinite(target.targetPitch) && Math.abs(target.targetPitch) <= 20 &&
    Number.isFinite(target.targetYaw) && Math.abs(target.targetYaw) <= 35 &&
    (target.targetPitch !== 0 || target.targetYaw !== 0),
  ) || !Number.isFinite(prompt.captureTimeoutMs) || prompt.captureTimeoutMs < 1) {
    throw new Error("WalletKit supplied an invalid PoseGuard prompt.");
  }
  const active = AbortSignal.any([signal, AbortSignal.timeout(Math.min(CHALLENGE_TIMEOUT_MS, Math.floor(prompt.captureTimeoutMs)))]);
  const accepted: Uint8Array[] = [];
  const steps = [null, ...prompt.targets];
  try {
    for (const target of steps) {
      active.throwIfAborted();
      const title = target ? `Turn your head ${poseDirection(target).label}` : "Look straight ahead";
      const completed = accepted.length;
      const phase = { title, target, cameraReady: true, poseStep: { index: completed + 1, total: steps.length } };
      update({ ...phase, phase: "framing", hint: "Keep your face in the oval.", progress: completed / steps.length });
      let alignedSince: number | undefined;
      let lastTimestamp = -Infinity;
      // Paint each new target before looking for a matching frame.
      await pause(75, active);
      while (accepted.length === completed) {
        const frame = await readFrame(active);
        try {
          active.throwIfAborted();
          if (frame.timestamp <= lastTimestamp || frame.timestamp - lastTimestamp > SAMPLE_GAP_MS) alignedSince = undefined;
          lastTimestamp = frame.timestamp;
          if (matchesPose(frame.pose, target)) {
            alignedSince ??= frame.timestamp;
            const progress = Math.min(1, (frame.timestamp - alignedSince) / (target ? 300 : CAPTURE_HOLD_DURATION_MS_V1));
            update({ ...phase, phase: "holding", hint: "Hold still.", progress: (completed + progress) / steps.length });
            if (progress === 1) {
              const bytes = await frame.png(active);
              if (active.aborted) { bytes.fill(0); active.throwIfAborted(); }
              accepted.push(bytes);
            }
          } else {
            alignedSince = undefined;
            update({ ...phase, phase: "framing", hint: "Keep your face in the oval.", progress: completed / steps.length });
          }
        } finally {
          frame.release();
        }
      }
    }
    const [centralPng, first, second, third] = accepted;
    return { centralPng, captures: [first, second, third] };
  } catch (error) {
    for (const image of accepted) image.fill(0);
    throw error;
  }
}

function matchesPose(pose: PoseObservation | null, target: PoseTarget | null): boolean {
  if (!pose) return false;
  const { left, right, top, bottom, pitch, yaw } = pose;
  if (left < 0.02 || right > 0.98 || top < 0.02 || bottom > 0.98 || right - left < 0.34 || bottom - top < 0.25) return false;
  return Math.abs(yaw - (target?.targetYaw ?? 0)) <= (target ? 8 : 6) &&
    Math.abs(pitch - (target?.targetPitch ?? 0)) <= (target ? 8 : 10);
}

async function encodePng(frame: HTMLCanvasElement, signal: AbortSignal): Promise<Uint8Array> {
  const blob = await abortable(new Promise<Blob>((resolve, reject) => {
    frame.toBlob(value => value ? resolve(value) : reject(new Error("Could not capture a PNG frame.")), "image/png");
  }), signal);
  if (blob.type !== "image/png" || blob.size < 1 || blob.size > MAX_IMAGE_BYTES) throw new Error("Camera PNG is outside the supported size.");
  return abortable(blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    if (signal.aborted) { bytes.fill(0); signal.throwIfAborted(); }
    return bytes;
  }), signal);
}
