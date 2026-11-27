import { expect, test } from "bun:test";
import { engineChecks, eyeRoll, faceIllumination } from "../lib/poseguard/engine-checks";
import type { PoseObservation } from "../lib/poseguard/types";

const centred: PoseObservation = { yaw: 0, pitch: 0, roll: 0, left: 0.2, right: 0.8, top: 0.2, bottom: 0.8 };

test("measures roll like FaceEngine: level eyes are 0° and a mirrored image is 180°", () => {
  // Landmark 0 is the physiological right eye, which appears on the image's left.
  expect(eyeRoll([0.4, 0.4, 0.6, 0.4])).toBe(0);
  expect(eyeRoll([0.4, 0.4, 0.6, 0.6])).toBeCloseTo(45);
  expect(Math.abs(eyeRoll([0.6, 0.4, 0.4, 0.4]))).toBe(180);
});

test("computes the face box's grey mean and histogram variance", () => {
  // 2×1 image; the box covers only the left pixel, then both.
  const pixels = new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255]);
  expect(faceIllumination(pixels, 2, 1, { left: 0, top: 0, right: 0.5, bottom: 1 })).toEqual({ mean: 100, variance: 0 });
  const both = faceIllumination(pixels, 2, 1, { left: 0, top: 0, right: 1, bottom: 1 });
  expect(both.mean).toBeCloseTo(150);
  expect(both.variance).toBeCloseTo((50 / 255) ** 2);
});

test("names the TEE reason for each central check a frame fails", () => {
  // Browser pitch -8 is a chin raised 8°.
  const failing = (pose: Partial<PoseObservation>) => engineChecks({ pose: { ...centred, ...pose }, width: 758, height: 1080, target: null })
    .filter(check => !check.passed).map(check => check.reason);
  expect(failing({})).toEqual([]);
  expect(failing({ pitch: -8 })).toEqual(["HeadPosePitchTooHigh"]);
  expect(failing({ pitch: 21 })).toEqual(["HeadPosePitchTooLow"]);
  expect(failing({ yaw: 18 })).toEqual(["HeadPoseYaw"]);
  expect(failing({ left: 0.05, right: 0.9 })).toEqual(["FaceTooBig"]);
  expect(failing({ left: 0.25, right: 0.75 })).toEqual(["FaceTooSmall"]);
  expect(failing({ roll: 180 })).toEqual(["HeadPoseRoll"]);
});

test("checks a challenge frame against its target and the PoseGuard roll tolerance", () => {
  const checks = engineChecks({ pose: { ...centred, yaw: 31, roll: 11 }, width: 758, height: 1080, target: { pitch: 0, yaw: 30 } });
  expect(checks.filter(check => !check.passed).map(check => check.check)).toEqual(["poseguard roll"]);
});

test("names the image edge a face box is too close to", () => {
  const failing = (box: Partial<PoseObservation>) => engineChecks({ pose: { ...centred, ...box }, width: 758, height: 1080, target: null })
    .filter(check => check.check === "face_alignment_validator" && !check.passed).map(check => check.reason);
  expect(failing({})).toEqual([]);
  expect(failing({ left: 0.01, right: 0.61 })).toEqual(["FaceTooFarLeft"]);
  expect(failing({ top: 0.3, bottom: 0.995 })).toEqual(["FaceTooLow"]);
});
