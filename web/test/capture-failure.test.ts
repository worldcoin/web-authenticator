import { expect, test } from "bun:test";
import { captureFailure } from "../lib/selfie-capture";

test.each([
  ["a reasonless abort", new DOMException("signal is aborted without reason", "AbortError")],
  ["a flow stop", new DOMException("The request flow stopped.", "AbortError")],
])("never shows the abort message for %s", (_name, error) => {
  expect(captureFailure(error)).toEqual({
    phase: "error", title: "We couldn't finish your selfie", hint: "Something went wrong. Please try again.",
    progress: 0, cameraReady: false,
  });
});

test("keeps an actionable flow error message", () => {
  const message = "Center frame failed the quality check. Keep your face in view and try again.";
  expect(captureFailure(new Error(message)).hint).toBe(message);
});
