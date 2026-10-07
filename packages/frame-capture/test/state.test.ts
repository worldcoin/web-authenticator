import { describe, expect, test } from "bun:test";
import {
  CAPTURE_STATES,
  isCaptureTransitionAllowed,
  reduceCaptureState,
  type CaptureState,
} from "../src";

describe("capture lifecycle reducer", () => {
  test("contains every frozen runtime state", () => {
    expect(CAPTURE_STATES).toEqual([
      "idle",
      "permission_request",
      "permission_denied",
      "camera_unavailable",
      "camera_busy",
      "camera_restricted",
      "acquiring",
      "awaiting_first_frame",
      "preview",
      "sampling",
      "artifact_ready",
      "interrupted",
      "expired",
      "failed",
      "cleaning_up",
      "complete",
    ]);
  });

  test("allows a successful metadata-only lifecycle", () => {
    const path = [
      "permission_request",
      "acquiring",
      "awaiting_first_frame",
      "preview",
      "sampling",
      "artifact_ready",
      "cleaning_up",
      "complete",
    ] as const;
    let state: CaptureState = "idle";
    for (const next of path) state = reduceCaptureState(state, next);
    expect(state).toBe("complete");
  });

  test("requires cleanup between terminal state and restart", () => {
    expect(isCaptureTransitionAllowed("sampling", "interrupted")).toBe(true);
    expect(isCaptureTransitionAllowed("interrupted", "permission_request")).toBe(false);
    expect(() => reduceCaptureState("interrupted", "permission_request")).toThrow();
    expect(isCaptureTransitionAllowed("complete", "permission_request")).toBe(true);
  });
});
