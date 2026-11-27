import { expect, test } from "bun:test";
import { eyeRoll } from "../lib/poseguard/engine-checks";

test("measures roll like FaceEngine: level eyes are 0° and a mirrored image is 180°", () => {
  // Landmark 0 is the physiological right eye, which appears on the image's left.
  expect(eyeRoll([0.4, 0.4, 0.6, 0.4])).toBe(0);
  expect(eyeRoll([0.4, 0.4, 0.6, 0.6])).toBeCloseTo(45);
  expect(Math.abs(eyeRoll([0.6, 0.4, 0.4, 0.4]))).toBe(180);
});
