import { expect, spyOn, test } from "bun:test";
import { clearDiagnostics, diagnosticAttempts, recordCaptureAttempt } from "../lib/poseguard/diagnostics";
import type { PoseObservation } from "../lib/poseguard/types";

const centred: PoseObservation = { yaw: 0, pitch: 0, roll: 0, left: 0.2, right: 0.8, top: 0.2, bottom: 0.8 };

test("records each step's gates and frame and attaches the TEE rejection to its step", () => {
  clearDiagnostics();
  const attempt = recordCaptureAttempt();
  attempt.started([{ pitch: 0, yaw: 30 }, { pitch: 17, yaw: 0 }, { pitch: 0, yaw: -30 }]);
  attempt.gated(1, "pitch");
  attempt.gated(1, "pitch");
  attempt.gated(1, "aligned");
  attempt.captured({ step: 1, target: null, pose: { ...centred, pitch: -8 }, png: Uint8Array.of(1, 2, 3), size: [758, 1080], heldMs: 1200, durationMs: 2400 });
  attempt.rejected({ status: "failed", reason: "quality_rejected" });

  const [recorded] = diagnosticAttempts();
  expect(recorded.outcome).toEqual({ status: "rejected", step: 1, reason: "quality_rejected" });
  expect(recorded.steps.map(step => step.target)).toEqual([null, { pitch: 0, yaw: 30 }, { pitch: 17, yaw: 0 }, { pitch: 0, yaw: -30 }]);
  const [central] = recorded.steps;
  expect(central.gates).toEqual({ pitch: 2, aligned: 1 });
  expect(central.frame).toMatchObject({ width: 758, height: 1080, bytes: 3, heldMs: 1200, durationMs: 2400, pose: { pitch: 8, yaw: 0, roll: 0 } });
  expect(central.frame?.checks.find(check => !check.passed)?.reason).toBe("HeadPosePitchTooHigh");

  const challenge = recordCaptureAttempt();
  challenge.rejected({ status: "failed", reason: "challenge", index: 1, challengeReason: "pose_mismatch" });
  expect(diagnosticAttempts()[0].outcome).toEqual({ status: "rejected", step: 3, reason: "pose_mismatch" });
  clearDiagnostics();
  expect(diagnosticAttempts()).toEqual([]);
});

test("keeps no image for an attempt cleared while its capture runs", () => {
  const created = spyOn(URL, "createObjectURL");
  try {
    const attempt = recordCaptureAttempt();
    attempt.started([{ pitch: 0, yaw: 30 }, { pitch: 17, yaw: 0 }, { pitch: 0, yaw: -30 }]);
    clearDiagnostics();
    attempt.captured({ step: 1, target: null, pose: centred, png: Uint8Array.of(1), size: [758, 1080], heldMs: 1200, durationMs: 2400 });
    expect(created).not.toHaveBeenCalled();
    expect(diagnosticAttempts()).toEqual([]);
  } finally {
    created.mockRestore();
  }
});

test("says why a frame has no illumination checks when its PNG cannot be decoded", async () => {
  const attempt = recordCaptureAttempt();
  attempt.started([{ pitch: 0, yaw: 30 }, { pitch: 17, yaw: 0 }, { pitch: 0, yaw: -30 }]);
  // Bun has no createImageBitmap, so reading the frame's pixels fails as an undecodable PNG would.
  attempt.captured({ step: 1, target: null, pose: centred, png: Uint8Array.of(1), size: [758, 1080], heldMs: 1200, durationMs: 2400 });
  await new Promise(resolve => setTimeout(resolve, 0));
  const frame = diagnosticAttempts()[0].steps[0].frame;
  expect(frame?.illuminationError).toBeString();
  expect(frame?.checks.some(check => check.check === "face_illumination_validator")).toBe(false);
  clearDiagnostics();
});

test("keeps the TEE verdict when the enrollment fails after it", () => {
  const attempt = recordCaptureAttempt();
  attempt.accepted();
  attempt.failed(new Error("The selfie enrollment does not match this wallet."));
  expect(diagnosticAttempts()[0].outcome).toEqual({ status: "accepted" });
  clearDiagnostics();
});
