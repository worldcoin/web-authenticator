import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import {
  AUTHENTICATOR_UI_COPY_V1,
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  AUTHENTICATOR_UI_DETAIL_CODES_V1,
  AUTHENTICATOR_UI_DETAIL_COPY_V1,
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
  WALKTHROUGH_ACTION_LABELS_V1,
  WALKTHROUGH_COPY_V1,
  WALKTHROUGH_DETAIL_COPY_V1,
  WALKTHROUGH_DISCLOSURE_V1,
  WALKTHROUGH_PASSKEY_READY_COPY_V1,
  WALKTHROUGH_RETURNED_HERO_V1,
} from "../src/walkthrough/production-copy";

const STAGING_WORDS = /template|not figma|injected|workflow artifact/i;

beforeAll(() => GlobalRegistrator.register());
afterEach(() => cleanup());
afterAll(() => GlobalRegistrator.unregister());

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

function renderWalkthrough(state: AuthenticatorUiStateIdV1) {
  return render(<FlowScreenV1
    snapshot={makeAuthenticatorUiSnapshotV1({
      state,
      detailCode: detailFor(state),
      authoritativeSessionState: authoritativeFor(state),
      rpPresentationId: state === "request_checking" ? null : "zoom_demo",
      visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[state],
    })}
    onAction={() => undefined}
    bannerText={null}
    copyOverride={WALKTHROUGH_COPY_V1[state]}
    detailCopyOverrides={WALKTHROUGH_DETAIL_COPY_V1}
    actionLabelOverrides={WALKTHROUGH_ACTION_LABELS_V1}
    disclosure={WALKTHROUGH_DISCLOSURE_V1}
    heroOverride={state === "returned" ? WALKTHROUGH_RETURNED_HERO_V1 : undefined}
    showTemplateNotice={false}
  />);
}

describe("walkthrough production presentation", () => {
  test("provides complete preview copy for every frozen state and detail code", () => {
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      const merged = { ...AUTHENTICATOR_UI_COPY_V1[state], ...WALKTHROUGH_COPY_V1[state] };
      const text = `${merged.heading} ${merged.body} ${merged.primaryAction ?? ""}`;
      expect(text, state).not.toMatch(STAGING_WORDS);
      expect(merged.heading.length, state).toBeGreaterThan(0);
    }
    for (const variant of Object.values(WALKTHROUGH_PASSKEY_READY_COPY_V1)) {
      expect(`${variant.heading} ${variant.body}`).not.toMatch(STAGING_WORDS);
    }
    for (const code of AUTHENTICATOR_UI_DETAIL_CODES_V1) {
      const detail = WALKTHROUGH_DETAIL_COPY_V1[code] ?? AUTHENTICATOR_UI_DETAIL_COPY_V1[code];
      expect(detail, code).not.toMatch(STAGING_WORDS);
    }
    expect(WALKTHROUGH_ACTION_LABELS_V1.return_to_rp).toBe("Return to Zoom");
  });

  test("renders every frozen state without internal placeholder wording and with one heading", () => {
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      const view = renderWalkthrough(state);
      expect(view.container.textContent, state).not.toMatch(STAGING_WORDS);
      expect(view.container.querySelectorAll("main")).toHaveLength(1);
      expect(view.container.querySelectorAll("h1")).toHaveLength(1);
      expect(view.container.querySelector(".template-notice")).toBeNull();
      expect(view.container.querySelector(".staging-banner")).toBeNull();
      view.unmount();
    }
  });

  test("keeps the Figma assets while identifying simulated success", () => {
    const pending = renderWalkthrough("biometric_simulation_pending");
    expect(pending.getByRole("heading", { name: "Verifying your selfie" })).toBeDefined();
    expect(pending.getByText("This might take few seconds")).toBeDefined();
    expect(pending.container.querySelector<HTMLImageElement>(".hero-icon--progress")?.getAttribute("src"))
      .toBe("/assets/figma/simulation-progress.svg");
    pending.unmount();

    for (const state of ["biometric_simulated_pass", "issuance_simulation_pending"] as const) {
      const view = renderWalkthrough(state);
      expect(view.getByRole("main").dataset.visualSource).toBe("figma_5132_135071");
      expect(view.getByRole("heading", { name: "Verifying your selfie" })).toBeDefined();
      expect(view.container.querySelector<HTMLImageElement>(".hero-icon--progress")?.getAttribute("src"))
        .toBe("/assets/figma/verification-complete.svg");
      expect(view.container.querySelector('.top-close[data-action="cancel"]')).not.toBeNull();
      view.unmount();
    }

    const success = renderWalkthrough("simulated_credential_ready");
    expect(success.getByRole("main").dataset.visualSource).toBe("figma_5132_135104");
    expect(success.getByRole("heading", { name: "Preview complete" })).toBeDefined();
    expect(success.getByText("Simulated result — no Selfie Check credential was issued.")).toBeDefined();
    expect(success.container.querySelector<HTMLImageElement>(".hero-icon--progress")?.getAttribute("src"))
      .toBe("/assets/figma/success-emblem.svg");
    expect(success.getByRole("button", { name: "Return to Zoom" }).dataset.action).toBe("return_to_rp");
    expect(success.queryByRole("alert")).toBeNull();
    success.unmount();

    const redirecting = renderWalkthrough("return_redirecting");
    expect(redirecting.getByRole("heading", { name: "You’re all set" })).toBeDefined();
    expect(redirecting.getByText("Returning to Zoom")).toBeDefined();
    redirecting.unmount();

    const returned = renderWalkthrough("returned");
    expect(returned.getByRole("heading", { name: "Returned to Zoom" })).toBeDefined();
    expect(returned.container.querySelector<HTMLImageElement>(".partner-icon img")?.getAttribute("alt")).toBe("Zoom");
    expect(returned.container.querySelector(".hero-icon")).toBeNull();
    returned.unmount();
  });

  test("opens with the Figma request disclosure for Zoom", () => {
    const view = renderWalkthrough("request_review");
    expect(view.getByRole("heading", { name: "Request from Zoom" })).toBeDefined();
    expect(view.getByRole("heading", { name: "App will receive" })).toBeDefined();
    expect(view.container.querySelector<HTMLImageElement>(".partner-icon img")?.getAttribute("src"))
      .toBe("/assets/figma/zoom-app-icon.png");
    const rows = [...view.container.querySelectorAll(".disclosure-row")].map((row) => ({
      text: row.querySelector("span")?.textContent,
      marker: row.querySelectorAll("img")[1]?.getAttribute("alt"),
    }));
    expect(rows).toEqual([
      { text: "Proof of selfie", marker: "Included" },
      { text: "Your selfie", marker: "Not included" },
      { text: "Your passkey", marker: "Not included" },
    ]);
    expect(view.getByRole("button", { name: "Continue" })).toBeDefined();
    view.unmount();
  });

  test("keeps the gated route on the frozen staging presentation", () => {
    const view = render(<FlowScreenV1
      snapshot={makeAuthenticatorUiSnapshotV1({
        state: "simulated_credential_ready",
        authoritativeSessionState: authoritativeFor("simulated_credential_ready"),
        rpPresentationId: "zoom_demo",
        visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1.simulated_credential_ready,
      })}
      onAction={() => undefined}
    />);
    expect(view.getByRole("heading", { name: "Staging demo complete" })).toBeDefined();
    expect(view.container.textContent).toContain("Staging demo");
    expect(view.container.textContent).toContain("not a Selfie Check credential");
    expect(view.getByRole("button", { name: "Return to app" })).toBeDefined();
    view.unmount();
  });

  test("has no automated accessibility violations on the walkthrough ending", async () => {
    for (const state of [
      "request_review",
      "biometric_simulation_pending",
      "biometric_simulated_pass",
      "simulated_credential_ready",
      "returned",
    ] as const) {
      const view = renderWalkthrough(state);
      const result = await axe.run(view.container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations, state).toEqual([]);
      view.unmount();
    }
  });
});
