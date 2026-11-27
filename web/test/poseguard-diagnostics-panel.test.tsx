import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render } from "@testing-library/react";
import PoseGuardDiagnostics from "../components/PoseGuardDiagnostics";
import { clearDiagnostics, recordCaptureAttempt } from "../lib/poseguard/diagnostics";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
afterAll(async () => { await new Promise(resolve => setTimeout(resolve, 0)); await GlobalRegistrator.unregister(); });
afterEach(() => { cleanup(); clearDiagnostics(); });

test("shows each step's capture and marks the step the TEE rejected", () => {
  const view = render(<PoseGuardDiagnostics />);
  act(() => {
    const attempt = recordCaptureAttempt();
    attempt.started([{ pitch: 0, yaw: 30 }, { pitch: 17, yaw: 0 }, { pitch: 0, yaw: -30 }]);
    attempt.gated(1, "pitch");
    attempt.captured({
      step: 1, target: null, pose: { yaw: 0, pitch: -8, roll: 0, left: 0.2, right: 0.8, top: 0.2, bottom: 0.8 },
      png: Uint8Array.of(1), size: [758, 1080], heldMs: 1200, durationMs: 2400,
    });
    attempt.rejected({ status: "failed", reason: "quality_rejected" });
  });
  expect(view.getByTestId("poseguard-diagnostics-toggle").textContent).toBe("PoseGuard debug · quality_rejected @1");
  act(() => view.getByTestId("poseguard-diagnostics-toggle").click());

  const steps = view.getAllByTestId("poseguard-diagnostics-step");
  expect(steps).toHaveLength(4);
  expect(steps[0].textContent).toContain("← rejected");
  expect(steps[0].textContent).toContain("758×1080 PNG");
  expect(steps[0].textContent).toContain("head_pose_validator → HeadPosePitchTooHigh");
  expect(steps[1].textContent).toContain("Not captured.");
  expect(view.getByText(/TEE rejected step 1/).textContent).toContain("quality_rejected");
});
