import { abortable, pause } from "../async";
import { logPoseGuardEvent, logPoseGuardStep } from "../flow-logging";
import { CAPTURE_HOLD_DURATION_MS_V1 } from "../hold-steady-progress";
import { grabFrame, type CaptureState } from "../selfie-capture";
import type { PoseDiagnostics, PoseGate, PoseGuardImages, PoseGuardPrompt, PoseObservation, PoseTarget } from "./types";
import { openPoseDetector } from "./worker";

const CHALLENGE_TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_POSE_ESTIMATE_EDGE = 720;
const SAMPLE_GAP_MS = 1_000;
const DIRECTIONS = ["right", "up and right", "up", "up and left", "left", "down and left", "down", "down and right"];

export interface PoseFrame {
  timestamp: number;
  pose: PoseObservation | null;
  stale?: boolean;
  dimensions?: Pick<PoseDiagnostics, "stream" | "png">;
  png(signal: AbortSignal): Promise<Uint8Array>;
  release(): void;
}

export function poseDirection(target: PoseTarget): { degrees: number; label: string } {
  // Mirror yaw for the preview. Positive pitch points down in the browser.
  const degrees = (Math.atan2(-target.pitch, -target.yaw) * 180 / Math.PI + 360) % 360;
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
      logPoseGuardStep("detector_initialize", () => openPoseDetector(active)),
      logPoseGuardStep("camera_open", () => abortable(navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
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
        update({
          phase: "framing", title: "Preparing your selfie check", hint: "Keep your face in the oval.", progress: 0, cameraReady: true,
          poseDiagnostics: import.meta.env.DEV ? { stream: [video.videoWidth, video.videoHeight] } : undefined,
        });
      }), active)),
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
        const streamSize = import.meta.env.DEV ? [video.videoWidth, video.videoHeight] as const : undefined;
        const frame = grabFrame(video);
        const clear = () => { frame.width = frame.height = 0; };
        try {
          const scale = Math.min(1, MAX_POSE_ESTIMATE_EDGE / Math.max(frame.width, frame.height));
          const bitmap = await abortable(createImageBitmap(frame, {
            resizeWidth: Math.max(1, Math.round(frame.width * scale)),
            resizeHeight: Math.max(1, Math.round(frame.height * scale)),
          }).then(bitmap => {
            if (signal.aborted) { bitmap.close(); signal.throwIfAborted(); }
            return bitmap;
          }), signal);
          const observed = await abortable(detector.analyze(bitmap, timestamp), signal);
          const stale = performance.now() - timestamp > SAMPLE_GAP_MS;
          return {
            timestamp,
            pose: stale ? null : observed,
            stale,
            dimensions: streamSize ? {
              stream: streamSize,
              png: [frame.width, frame.height],
            } : undefined,
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
    for (const issuedTarget of steps) {
      active.throwIfAborted();
      // Positive pitch points up in FaceEngine and down in the browser estimate.
      const target = issuedTarget && { pitch: -issuedTarget.targetPitch, yaw: issuedTarget.targetYaw };
      const title = target ? `Turn your head ${poseDirection(target).label}` : "Look straight ahead";
      const requiredMs = target ? 300 : CAPTURE_HOLD_DURATION_MS_V1;
      const completed = accepted.length;
      const phase = { title, target, cameraReady: true, poseStep: { index: completed + 1, total: steps.length } };
      const shownAt = performance.now();
      update({ ...phase, phase: "framing", hint: "Keep your face in the oval.", progress: completed / steps.length });
      logPoseGuardEvent("poseguard_target", {
        status: "shown", step: phase.poseStep.index, title,
        targetPitch: issuedTarget?.targetPitch ?? 0, targetYaw: issuedTarget?.targetYaw ?? 0,
        previewPitch: target?.pitch ?? 0,
      });
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
          const gate = frame.stale ? "stale" : poseGate(frame.pose, target);
          const aligned = gate === "aligned";
          alignedSince = aligned ? (alignedSince ?? frame.timestamp) : undefined;
          const heldMs = alignedSince === undefined ? 0 : frame.timestamp - alignedSince;
          const poseDiagnostics: PoseDiagnostics | undefined = import.meta.env.DEV ? {
            ...frame.dimensions,
            sample: {
              step: phase.poseStep.index, targetPitch: target?.pitch ?? 0, targetYaw: target?.yaw ?? 0,
              pitch: frame.pose ? Math.round(frame.pose.pitch) : undefined,
              yaw: frame.pose ? Math.round(frame.pose.yaw) : undefined,
              gate, heldMs: Math.round(heldMs), requiredMs,
            },
          } : undefined;
          if (aligned) {
            const progress = Math.min(1, heldMs / requiredMs);
            update({ ...phase, poseDiagnostics, phase: "holding", hint: "Hold still.", progress: (completed + progress) / steps.length });
            if (progress === 1) {
              const bytes = await frame.png(active);
              if (active.aborted) { bytes.fill(0); active.throwIfAborted(); }
              accepted.push(bytes);
              logPoseGuardEvent("poseguard_target", {
                status: "captured", step: phase.poseStep.index,
                durationMs: Math.round(performance.now() - shownAt),
                heldMs: Math.round(heldMs),
                ...(frame.dimensions?.png ? { png: frame.dimensions.png.join("×") } : {}),
              });
            }
          } else {
            update({ ...phase, poseDiagnostics, phase: "framing", hint: "Keep your face in the oval.", progress: completed / steps.length });
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

function poseGate(pose: PoseObservation | null, target: PoseTarget | null): PoseGate {
  if (!pose) return "no_estimate";
  const { left, right, top, bottom, pitch, yaw } = pose;
  if (left < 0.02 || right > 0.98 || top < 0.02 || bottom > 0.98 || right - left < 0.34 || bottom - top < 0.25) return "framing";
  const yawMatches = Math.abs(yaw - (target?.yaw ?? 0)) <= (target ? 8 : 6);
  const pitchMatches = Math.abs(pitch - (target?.pitch ?? 0)) <= (target ? 8 : 10);
  if (!pitchMatches) return yawMatches ? "pitch" : "pitch_and_yaw";
  return yawMatches ? "aligned" : "yaw";
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
