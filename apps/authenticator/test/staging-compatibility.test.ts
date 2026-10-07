import { describe, expect, test } from "bun:test";
import type { BrowserAdmissionDecisionV1 } from "@clean-start/browser-admission";
import {
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  type SimulatorBrowserDemoAuthenticatorReadyV0,
} from "@clean-start/contracts";
import { makeExplicitStagingCaptureEntryV0 } from "../src/adapters/staging-compatibility";

const admission: BrowserAdmissionDecisionV1 = {
  version: "browser_admission_v1",
  outcome: "eligible_candidate",
  reason: "candidate_only_ceremony_required",
  mayStartSensitiveFlow: true,
  browser: "safari",
  iosVersionBand: "ios_18_plus",
  context: "normal_tab",
  engine: "unknown",
  region: "unknown",
  provider: "unknown",
  capabilities: {
    webAuthnApi: "available",
    platformUv: "available",
    clientCapabilitiesApi: "unknown",
    conditionalMediation: "unknown",
    mediaApi: "available",
    visibility: "visible",
  },
};

const ready: SimulatorBrowserDemoAuthenticatorReadyV0 = {
  kind: SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  version: SIMULATOR_BROWSER_SESSION_PORT_V0,
  mode: SIMULATION_MODE,
  environment: SIMULATION_ENVIRONMENT,
  sessionId: "session",
  idempotencyKey: "demo-idempotency",
  completionHandle: "opaque-completion",
  claims: {
    webauthnPerformed: false,
    prfEvaluated: false,
    worldIdCreated: false,
  },
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("explicit staging compatibility", () => {
  test("isolates the legacy W04 prfReady translation behind negative demo claims", () => {
    expect(makeExplicitStagingCaptureEntryV0({ admission, ready, userActivated: true })).toEqual({
      userActivated: true,
      secureTopLevelContextApproved: true,
      prfReady: true,
      iosMajor: 18,
      browser: "safari",
    });
    expect(ready.claims).toEqual({
      webauthnPerformed: false,
      prfEvaluated: false,
      worldIdCreated: false,
    });
  });

  test("rejects every noneligible admission decision", () => {
    expect(() => makeExplicitStagingCaptureEntryV0({
      admission: { ...admission, outcome: "unsupported", mayStartSensitiveFlow: false },
      ready,
      userActivated: true,
    })).toThrow("staging_capture_gate_not_satisfied");
  });
});
