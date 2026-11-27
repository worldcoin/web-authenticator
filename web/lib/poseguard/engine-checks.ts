import { ENGINE_FRAMING_V1 } from "../rgbnet";
import type { PoseObservation } from "./types";

/**
 * The TEE worker's PoseGuard selfie checks that the browser can reproduce, in FaceEngine signs (positive pitch
 * points up). Source: worldcoin/biometric-engines `biometric-engines-worker-v0.3.0` (4cb51ca),
 * biometric-engines-worker/config/pose_guard_selfie.yaml and src/face/engine/poseguard.rs, and
 * face_engine/src/nodes/{property_estimators/head_pose.rs,qa/image_capture/face_illumination.rs}.
 * The TEE stays authoritative; matching it here avoids sending frames it will reject.
 */
export const ENGINE_POSE_V1 = Object.freeze({
  // HeadPoseValidator on the central frame: every bound is exclusive.
  central: { maxYaw: 18, minPitch: -20, maxPitch: 6, maxRoll: 45 },
  // PoseGuardModel on each challenge frame: deviation from the target, whose roll is 0.
  challengeTolerance: 10,
});

export const ENGINE_ILLUMINATION_V1 = Object.freeze({ minMean: 40, maxMean: 200, maxVariance: 0.08 });

/** Kept off every TEE bound so a frame the browser accepts is not rejected for a rounding difference. */
export const POSE_GATE_MARGIN_DEGREES = 2;

export type EnginePose = { pitch: number; yaw: number; roll: number };
export type EngineTarget = { pitch: number; yaw: number };

/** The browser estimate in FaceEngine signs. The browser's pitch points down. */
export function enginePose(pose: PoseObservation): EnginePose {
  return { pitch: -pose.pitch, yaw: pose.yaw, roll: pose.roll };
}

/** FaceEngine's roll: the angle from the physiological right eye (landmark 0) to the left eye (landmark 1). */
export function eyeRoll(landmarks: readonly number[]): number {
  const [rightX, rightY, leftX, leftY] = landmarks;
  return Math.atan2(leftY - rightY, leftX - rightX) * 180 / Math.PI;
}

export type EngineCheck = {
  /** The FaceEngine validator, as named in the worker config. */
  check: string;
  /** The worker's ValidationReason when the check fails. */
  reason: string;
  value: number;
  limit: string;
  passed: boolean;
};

/**
 * Every check the browser can evaluate on one captured frame, against the TEE's own thresholds (no margin).
 * `pixels` is the RGBA frame; without it the illumination checks are left out.
 */
export function engineChecks(
  frame: { pose: PoseObservation; width: number; height: number; target: EngineTarget | null },
  pixels?: Uint8ClampedArray,
): EngineCheck[] {
  const { pose, width, height, target } = frame;
  const { minRelativeSize, maxRelativeSize, minResolutionPx, edgeMargin } = ENGINE_FRAMING_V1;
  const boxWidth = pose.right - pose.left, boxHeight = pose.bottom - pose.top;
  const angles = enginePose(pose);
  const checks: EngineCheck[] = [
    check("face_bbox_size_validator", "FaceTooSmall", Math.min(boxWidth, boxHeight), `> ${minRelativeSize}`, value => value > minRelativeSize),
    check("face_bbox_size_validator", "FaceTooBig", Math.max(boxWidth, boxHeight), `< ${maxRelativeSize}`, value => value < maxRelativeSize),
    check("face_bbox_resolution_validator", "FaceResolutionTooLow", Math.min(boxWidth * width, boxHeight * height), `> ${minResolutionPx} px`, value => value > minResolutionPx),
    check("face_alignment_validator", "FaceTooHigh / FaceTooLow / FaceTooFarLeft / FaceTooFarRight",
      Math.min(pose.left, pose.top, 1 - pose.right, 1 - pose.bottom), `≥ ${edgeMargin}`, value => value >= edgeMargin),
  ];
  if (target) {
    const tolerance = ENGINE_POSE_V1.challengeTolerance;
    checks.push(
      check("poseguard yaw", "PoseGuardTargetMismatch", Math.abs(angles.yaw - target.yaw), `≤ ${tolerance}°`, value => value <= tolerance),
      check("poseguard pitch", "PoseGuardTargetMismatch", Math.abs(angles.pitch - target.pitch), `≤ ${tolerance}°`, value => value <= tolerance),
      check("poseguard roll", "PoseGuardTargetMismatch", Math.abs(angles.roll), `≤ ${tolerance}°`, value => value <= tolerance),
    );
  } else {
    const { maxYaw, minPitch, maxPitch, maxRoll } = ENGINE_POSE_V1.central;
    checks.push(
      check("head_pose_validator", "HeadPoseYaw", Math.abs(angles.yaw), `< ${maxYaw}°`, value => value < maxYaw),
      check("head_pose_validator", angles.pitch >= maxPitch ? "HeadPosePitchTooHigh" : "HeadPosePitchTooLow",
        angles.pitch, `${minPitch}° … ${maxPitch}° (up is positive)`, value => value > minPitch && value < maxPitch),
      check("head_pose_validator", "HeadPoseRoll", Math.abs(angles.roll), `< ${maxRoll}°`, value => value < maxRoll),
    );
  }
  if (pixels) {
    const { mean, variance } = faceIllumination(pixels, width, height, pose);
    const { minMean, maxMean, maxVariance } = ENGINE_ILLUMINATION_V1;
    checks.push(
      check("face_illumination_validator", mean <= minMean ? "ImageTooDark" : "ImageTooBright", mean, `${minMean} … ${maxMean}`, value => value > minMean && value < maxMean),
      check("face_illumination_validator", "IlluminationVariance", variance, `< ${maxVariance}`, value => value < maxVariance),
    );
  }
  return checks;
}

/** FaceIlluminationQa: grey mean (0–255) and histogram variance (0–1) of the face box, clipped to the image. */
export function faceIllumination(pixels: Uint8ClampedArray, width: number, height: number, box: Pick<PoseObservation, "left" | "top" | "right" | "bottom">) {
  const x0 = Math.max(0, Math.trunc(box.left * width)), y0 = Math.max(0, Math.trunc(box.top * height));
  const x1 = Math.min(width, Math.trunc(box.right * width)), y1 = Math.min(height, Math.trunc(box.bottom * height));
  const histogram = new Uint32Array(256);
  let sum = 0, count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * width + x) * 4;
      const grey = Math.min(255, 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]);
      sum += grey;
      histogram[Math.round(grey)]++;
      count++;
    }
  }
  if (count === 0) return { mean: 0, variance: 0 };
  const mean = sum / count;
  let variance = 0;
  for (let level = 0; level < 256; level++) variance += histogram[level] / count * (level / 255 - mean / 255) ** 2;
  return { mean, variance };
}

function check(name: string, reason: string, value: number, limit: string, passes: (value: number) => boolean): EngineCheck {
  return { check: name, reason, value, limit, passed: passes(value) };
}
