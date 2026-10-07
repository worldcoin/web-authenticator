import { describe, expect, test } from "bun:test";
import {
  AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1,
  makeAuthenticatorUiEventV1,
  transitionAuthenticatorUiV1,
  type AuthenticatorUiEventTypeV1,
} from "@clean-start/contracts";
import { evaluateClientQualityV0 } from "@clean-start/client-quality";
import { SIMULATOR_UI_QUALITY_POLICY_V0 } from "@clean-start/contracts";
import { snapshotFor } from "../testkit/ui";

const lifecycleEvents = [
  "page_hidden",
  "page_unloaded",
  "orientation_invalidated",
  "component_unmounted",
  "operation_interrupted",
] as const satisfies readonly AuthenticatorUiEventTypeV1[];

const inFlightStates = [
  "request_checking",
  "admission_checking",
  "admission_handoff_departing",
  "session_creating",
  "demo_authenticator_pending",
  "session_completing_authenticator",
  "session_reconciling",
  "capture_policy_loading",
  "capture_permission_request",
  "capture_acquiring",
  "capture_preparing",
  "capture_sampling",
  "capture_artifact_ready",
  "capture_cleaning",
  "capture_complete",
  "biometric_simulation_pending",
  "biometric_simulated_pass",
  "issuance_simulation_pending",
  "return_redirecting",
] as const;

describe("cancellation, lifecycle, and UX-only quality", () => {
  test("defines exactly 19 in-flight states", () => {
    expect(inFlightStates).toHaveLength(19);
  });

  for (const state of inFlightStates) {
    test(`${state} exposes cancellation in the frozen cleanup order`, () => {
      expect(AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state]).toContain("cancel");
      const current = snapshotFor(state);
      const transition = transitionAuthenticatorUiV1(
        current,
        makeAuthenticatorUiEventV1({ event: "cancel_requested" }),
      );
      expect(transition?.snapshot.state).toBe("flow_cancelling");
      expect(transition?.effects.slice(0, 3)).toEqual([
        "abort_active_effects",
        "stop_capture",
        "clear_transient_media",
      ]);
      expect(transition?.effects.includes("cancel_session")).toBe(
        current.authoritativeSessionState !== null,
      );
      if (current.authoritativeSessionState !== null) {
        expect(transition?.effects.at(-1)).toBe("cancel_session");
      }
    });

    test(`${state} accepts all five lifecycle aborts`, () => {
      for (const event of lifecycleEvents) {
        const current = snapshotFor(state);
        const transition = transitionAuthenticatorUiV1(
          current,
          makeAuthenticatorUiEventV1({ event }),
        );
        expect(transition?.snapshot.state).toBe("flow_cancelling");
        expect(transition?.effects.slice(0, 3)).toEqual([
          "abort_active_effects",
          "stop_capture",
          "clear_transient_media",
        ]);
      }
    });
  }

  test("quality outputs expose only UX actions/reasons and never a scenario or outcome", () => {
    const sources = [
      { readCameraActive: () => true },
      { readCameraActive: () => false },
      { readCameraActive: () => null },
    ];
    for (const source of sources) {
      const result = evaluateClientQualityV0(
        SIMULATOR_UI_QUALITY_POLICY_V0,
        source,
        { retakesUsed: 0 },
      );
      expect(["ready", "adjust", "retake", "unavailable"]).toContain(result.action);
      expect(Object.keys(result).sort()).toEqual([
        "action",
        "policyId",
        "reasonCodes",
        "version",
      ]);
      expect(JSON.stringify(result)).not.toMatch(/scenario|biometric|issuance|success/i);
    }
  });
});
