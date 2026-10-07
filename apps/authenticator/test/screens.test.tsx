import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import {
  AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1,
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  AUTHENTICATOR_UI_STATES_V1,
  ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1,
  ENROLLMENT_SESSION_STATES_V2,
  makeAuthenticatorUiSnapshotV1,
  type AuthenticatorUiDetailCodeV1,
  type AuthenticatorUiStateIdV1,
  type EnrollmentSessionStateV2,
} from "@clean-start/contracts";
import { FlowScreenV1 } from "../src/components/FlowScreen";
import {
  CAPTURE_OVAL_CLIP_PATH_V1,
  CAPTURE_OVAL_DOT_COUNT_V1,
  CAPTURE_OVAL_VIDEO_INSET_PX_V1,
} from "../src/assets/capture-oval-geometry";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => {
  cleanup();
  GlobalRegistrator.unregister();
});

function detailFor(state: AuthenticatorUiStateIdV1): AuthenticatorUiDetailCodeV1 | null {
  if (state === "capture_guidance_adjust") return "move_closer";
  if (state === "capture_guidance_retake") return "image_blurry";
  if (state === "capture_guidance_unavailable") return "framing_guidance_unavailable";
  if (state === "capture_error") return "permission_denied";
  if (state === "session_error") return "network_timeout";
  if (state === "return_callback_failed") return "navigation_failed";
  if (state === "flow_failed") return "safe_internal_error";
  return null;
}

function authoritativeFor(state: AuthenticatorUiStateIdV1): EnrollmentSessionStateV2 | null {
  for (const serverState of ENROLLMENT_SESSION_STATES_V2) {
    if (ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1[serverState].includes(state)) return serverState;
  }
  return null;
}

function snapshot(state: AuthenticatorUiStateIdV1) {
  return makeAuthenticatorUiSnapshotV1({
    state,
    detailCode: detailFor(state),
    authoritativeSessionState: authoritativeFor(state),
    rpPresentationId: state === "request_checking" ? null : "zoom_demo",
    visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[state],
  });
}

describe("complete UI render registry", () => {
  test("renders one main and one h1 for every frozen state", () => {
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      const view = render(<FlowScreenV1 snapshot={snapshot(state)} onAction={() => undefined} />);
      expect(view.container.querySelectorAll("main")).toHaveLength(1);
      expect(view.container.querySelectorAll("h1")).toHaveLength(1);
      expect(view.container.textContent).toContain("Staging demo");
      expect(view.container.querySelector("main")?.dataset.state).toBe(state);
      expect(view.container.querySelectorAll("button").length).toBeGreaterThanOrEqual(
        AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state].length,
      );
      view.unmount();
    }
  });

  test("renders the safe RP disclosure and no native browser chrome", () => {
    const view = render(<FlowScreenV1 snapshot={snapshot("request_review")} onAction={() => undefined} />);
    expect(view.getByRole("heading", { name: "Camera-flow demo for Zoom" })).toBeDefined();
    expect(view.getByText("Staging workflow result")).toBeDefined();
    expect(view.getByText("Camera images stay on this device")).toBeDefined();
    expect(document.body.textContent).not.toContain("Proof of selfie");
    expect(document.body.textContent).not.toContain("9:41");
    expect(document.body.textContent).not.toContain("world.id");
  });

  test("labels quota-blocked outcome families as not Figma verified", () => {
    const view = render(<FlowScreenV1 snapshot={snapshot("biometric_simulated_reject")} onAction={() => undefined} />);
    expect(view.getByRole("main").dataset.visualSource).toBe("not_figma_verified");
    expect(view.getByText("Template view · Not Figma verified")).toBeDefined();
  });

  test("uses the exact pending asset with security-safe copy and no face fixture", () => {
    const pending = render(<FlowScreenV1 snapshot={snapshot("biometric_simulation_pending")} onAction={() => undefined} />);
    expect(pending.getByRole("heading", { name: "Running staging scenario" })).toBeDefined();
    expect(pending.container.querySelector<HTMLImageElement>(".hero-icon--progress")?.src)
      .toEndWith("/assets/figma/simulation-progress.svg");
    expect(pending.container.textContent).not.toContain("Verifying your selfie");
    pending.unmount();

    const capture = render(<FlowScreenV1 snapshot={snapshot("capture_preview")} onAction={() => undefined} />);
    const imageSources = [...capture.container.querySelectorAll<HTMLImageElement>("img")]
      .map((image) => image.getAttribute("src"));
    expect(imageSources.some((source) => source?.endsWith(".png"))).toBe(false);
    const mediaHost = capture.container.querySelector(".media-host--visible");
    expect(mediaHost?.getAttribute("aria-hidden")).toBeNull();
    expect(mediaHost?.querySelector(".media-clip video")).not.toBeNull();
    expect(mediaHost?.querySelector(".capture-ring")).not.toBeNull();
    expect(mediaHost?.querySelector<HTMLElement>(".media-clip")?.style.clipPath)
      .toBe(CAPTURE_OVAL_CLIP_PATH_V1);
    expect(CAPTURE_OVAL_CLIP_PATH_V1.match(/\d+\.\d+% \d+\.\d+%/g))
      .toHaveLength(CAPTURE_OVAL_DOT_COUNT_V1);
    expect(CAPTURE_OVAL_VIDEO_INSET_PX_V1).toBe(8);
    expect(CAPTURE_OVAL_VIDEO_INSET_PX_V1).toBeGreaterThan(2.94866);
  });

  test("renders allowlisted live guidance inside the capture status pill", () => {
    const view = render(<FlowScreenV1
      snapshot={snapshot("capture_preview")}
      onAction={() => undefined}
      liveCaptureGuidance={{ code: "move_closer", text: "Move closer" }}
    />);
    const status = view.getByRole("status");
    expect(status.getAttribute("data-live-guidance")).toBe("move_closer");
    expect(view.getByRole("heading", { name: "Move closer" })).toBeDefined();
    view.rerender(<FlowScreenV1
      snapshot={snapshot("capture_complete")}
      onAction={() => undefined}
      liveCaptureGuidance={{ code: "move_closer", text: "Move closer" }}
    />);
    expect(view.getByRole("heading", { name: "Capture complete" })).toBeDefined();
  });

  test("reveals the exact blue Figma ring one dot at a time and shows completion", () => {
    const view = render(<FlowScreenV1
      snapshot={snapshot("capture_preview")}
      onAction={() => undefined}
      liveCaptureGuidance={{
        code: "hold_steady",
        text: "Great position, hold steady",
      }}
      captureProgress={0.5}
      hiddenActions={["collect_frame_metadata"]}
    />);
    const progress = view.container.querySelector<HTMLElement>(".capture-visual");
    const blueRing = view.container.querySelector<HTMLElement>(".capture-ring--progress");
    expect(progress?.dataset.captureProgressDots).toBe("32");
    expect(blueRing?.getAttribute("src")).toBe("/assets/figma/capture-ring-complete.svg");
    expect(blueRing?.style.getPropertyValue("--capture-progress-angle")).toBe("180deg");
    expect(view.queryByRole("button", { name: "Collect frame metadata" })).toBeNull();

    view.rerender(<FlowScreenV1
      snapshot={snapshot("capture_preview")}
      onAction={() => undefined}
      liveCaptureGuidance={{
        code: "hold_steady",
        text: "Great position, hold steady",
      }}
      captureProgress={1}
      hiddenActions={["collect_frame_metadata"]}
    />);
    expect(view.getByRole("heading", { name: "You’re all set" })).toBeDefined();
    expect(view.container.querySelector(".capture-ring--progress-complete")).not.toBeNull();
    expect(view.container.querySelector(".capture-message img")?.getAttribute("src"))
      .toBe("/assets/figma/capture-check.svg");
  });

  test("exposes every frozen action and sends its exact action id", () => {
    const actions: string[] = [];
    const view = render(<FlowScreenV1
      snapshot={snapshot("biometric_simulated_unavailable")}
      onAction={(action) => actions.push(action)}
    />);
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    fireEvent.click(view.getByRole("button", { name: "Check status" }));
    fireEvent.click(view.getAllByRole("button", { name: "Cancel" }).at(-1)!);
    expect(actions).toEqual(["retry_same_operation", "query_status", "cancel"]);
  });

  test("moves focus to the new heading and keeps visible cancel controls semantic", () => {
    const view = render(<FlowScreenV1 snapshot={snapshot("demo_authenticator_intro")} onAction={() => undefined} />);
    expect(document.activeElement).toBe(view.getByRole("heading", { name: "Try the authenticator step" }));
    expect(view.getByRole("button", { name: "Cancel" }).querySelector("img")?.getAttribute("src"))
      .toBe("/assets/figma/close.svg");
    view.rerender(<FlowScreenV1 snapshot={snapshot("capture_intro")} onAction={() => undefined} />);
    expect(document.activeElement).toBe(view.getByRole("heading", { name: "Try the camera step" }));
  });

  test("renders Cancel exactly once and reserves the top close for verified layouts", () => {
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      if (!AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state].includes("cancel")) continue;
      const view = render(<FlowScreenV1 snapshot={snapshot(state)} onAction={() => undefined} />);
      expect(view.container.querySelectorAll('[data-action="cancel"]')).toHaveLength(1);
      view.unmount();
    }

    const verified = render(<FlowScreenV1 snapshot={snapshot("demo_authenticator_intro")} onAction={() => undefined} />);
    expect(verified.container.querySelector('.top-close[data-action="cancel"]')).not.toBeNull();
    expect(verified.container.querySelector('.actions [data-action="cancel"]')).toBeNull();
    verified.unmount();

    const generic = render(<FlowScreenV1 snapshot={snapshot("biometric_simulated_unavailable")} onAction={() => undefined} />);
    expect(generic.container.querySelector(".top-close")).toBeNull();
    expect(generic.container.querySelector('.actions [data-action="cancel"]')).not.toBeNull();
  });

  test("announces every admission-block terminal as an assertive alert", () => {
    for (const state of [
      "admission_update_required",
      "admission_insecure",
      "admission_framed",
      "admission_private",
      "admission_pwa",
      "admission_unknown",
    ] as const) {
      const view = render(<FlowScreenV1 snapshot={snapshot(state)} onAction={() => undefined} />);
      const alert = view.getByRole("alert");
      expect(alert.getAttribute("aria-live")).toBe("assertive");
      expect(alert.textContent).toContain(view.getByRole("heading").textContent);
      view.unmount();
    }
  });

  test("does not announce success, cancellation, closure, or returned terminals as alerts", () => {
    for (const state of [
      "simulated_credential_ready",
      "flow_cancelled",
      "flow_closed",
      "returned",
    ] as const) {
      const view = render(<FlowScreenV1 snapshot={snapshot(state)} onAction={() => undefined} />);
      expect(view.queryByRole("alert")).toBeNull();
      view.unmount();
    }
  });

  test("has no automated accessibility violations in each visual family", async () => {
    for (const state of [
      "request_review",
      "demo_authenticator_intro",
      "capture_intro",
      "capture_preview",
      "biometric_simulation_pending",
      "biometric_simulated_reject",
    ] as const) {
      const view = render(<FlowScreenV1 snapshot={snapshot(state)} onAction={() => undefined} />);
      const result = await axe.run(view.container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations).toEqual([]);
      view.unmount();
    }
  });
});
