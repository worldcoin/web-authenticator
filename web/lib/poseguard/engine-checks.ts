import type { PoseObservation } from "./types";

/**
 * The TEE worker's (v0.3.0) PoseGuard selfie pose checks, in FaceEngine signs (positive pitch points up).
 * The TEE stays authoritative; matching it here avoids sending frames it will reject.
 */
export const ENGINE_POSE_V1 = Object.freeze({
  // HeadPoseValidator on the central frame: every bound is exclusive.
  central: { maxYaw: 18, minPitch: -20, maxPitch: 6, maxRoll: 45 },
  // PoseGuardModel on each challenge frame: deviation from the target, whose roll is 0.
  challengeTolerance: 10,
});

/** Kept off every TEE bound so a frame the browser accepts is not rejected for a rounding difference. */
export const POSE_GATE_MARGIN_DEGREES = 2;

export type EnginePose = { pitch: number; yaw: number; roll: number };
export type EngineTarget = { pitch: number; yaw: number };

/** The browser estimate in FaceEngine signs. The browser's pitch points down. */
export function enginePose(pose: PoseObservation): EnginePose {
  return { pitch: -pose.pitch, yaw: pose.yaw, roll: pose.roll };
}

/**
 * FaceEngine's roll: the angle from the physiological right eye (landmark 0) to the left eye (landmark 1).
 * Like FaceEngine, it uses landmarks as fractions of the image size, not pixels.
 */
export function eyeRoll(landmarks: readonly number[]): number {
  const [rightX, rightY, leftX, leftY] = landmarks;
  return Math.atan2(leftY - rightY, leftX - rightX) * 180 / Math.PI;
}
