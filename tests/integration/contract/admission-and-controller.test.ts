import { describe, expect, test } from "bun:test";
import {
  PRF_INPUT_V1_SHA256,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  WEB_AUTHN_PRF_AUTHENTICATOR_V1,
  type FrameBundleV0,
} from "@clean-start/contracts";
import {
  admitBrowserV1,
  type BrowserAdmissionDecisionV1,
  type BrowserAdmissionInputV1,
} from "@clean-start/browser-admission";
import type {
  BrowserCaptureAdapterV1,
  BrowserCaptureCallbacksV1,
  BrowserCaptureStartV1,
} from "../../../apps/authenticator/src/adapters/browser-capture";
import type { BrowserAdmissionAdapterV1 } from "../../../apps/authenticator/src/adapters/browser-admission";
import { AuthenticatorFlowControllerV1 } from "../../../apps/authenticator/src/flow/controller";
import { createAuthenticatorServerRuntimeV0 } from "../../../apps/authenticator/src/server/runtime.server";
import { metadataBundle } from "../testkit/runtime";

const policy = Object.freeze({
  version: WEB_AUTHN_PRF_AUTHENTICATOR_V1,
  rpId: "auth.example.test",
  allowedOrigins: Object.freeze(["https://auth.example.test"]),
  userVerification: "required" as const,
  prfInputSha256: PRF_INPUT_V1_SHA256,
  prfOutputMapping: "verbatim_32_byte_first_result_to_world_id_4_signer_seed" as const,
  secretLifecycle: "browser_memory_only" as const,
});

function admissionInput(
  iosMajor: number,
  browser: "safari" | "chrome",
  overrides: Partial<BrowserAdmissionInputV1> = {},
): BrowserAdmissionInputV1 {
  return {
    actualOrigin: "https://auth.example.test",
    isTopLevel: true,
    frameOrigin: "same_origin",
    permissionsPolicy: "allowed",
    requestContext: {
      transactionHandle: "validated",
      returnTarget: "validated",
      session: "approved",
      unexpectedQueryFields: false,
    },
    platform: { device: "iphone", iosMajor, browser },
    browserContext: "normal_tab",
    embeddedEvidence: "none",
    capabilities: {
      secureContext: true,
      webAuthnApi: "available",
      platformUv: "available",
      clientCapabilitiesApi: "unknown",
      conditionalMediation: "unknown",
      mediaApi: "available",
      visibility: "visible",
    },
    ...overrides,
  };
}

function adapter(decision: BrowserAdmissionDecisionV1): BrowserAdmissionAdapterV1 {
  return {
    async evaluate() { return decision; },
    async openExternalBrowser() {},
  };
}

class DeterministicMetadataCapture implements BrowserCaptureAdapterV1 {
  starts = 0;
  stops = 0;
  clears = 0;
  metadataRequests = 0;
  private callbacks?: BrowserCaptureCallbacksV1;
  private input?: BrowserCaptureStartV1;
  private emitted = false;
  private pending: Promise<void> = Promise.resolve();

  start(input: BrowserCaptureStartV1, callbacks: BrowserCaptureCallbacksV1): void {
    this.starts += 1;
    this.emitted = false;
    this.pending = Promise.resolve();
    this.input = input;
    this.callbacks = callbacks;
    void callbacks.onCaptureState("acquiring");
    void callbacks.onCaptureState("awaiting_first_frame");
    void callbacks.onCaptureState("preview");
  }

  requestMetadataCollection(): void {
    this.metadataRequests += 1;
    if (this.emitted || this.callbacks === undefined || this.input === undefined) return;
    this.emitted = true;
    const callbacks = this.callbacks;
    const input = this.input;
    this.pending = (async () => {
      await callbacks.onQuality({
        version: "client_quality_policy_v0",
        policyId: input.qualityPolicy.policyId,
        action: "ready",
        reasonCodes: [],
      });
      const artifact: FrameBundleV0 = await metadataBundle({
        kind: "simulator_browser_session_view_v0",
        version: "simulator_browser_session_port_v0",
        mode: "simulation",
        environment: "staging",
        sessionId: input.sessionId,
        browserHandle: "test-only-not-serialized",
        nonceBase64Url: "not-used-directly",
        state: "capture_ready",
        code: "capture_ready",
        retryable: false,
        expiresAt: input.policy.expiresAt,
        capturePolicy: input.policy,
        artifactSummary: null,
      }, input.accountPublicMaterialDigestSha256);
      const reboundArtifact = {
        ...artifact,
        nonceDigestSha256: input.nonceDigestSha256,
      };
      const finalized = {
        ...reboundArtifact,
        artifactDigestSha256: await (async () => {
          const { computeFrameBundleDigestV0 } = await import("@clean-start/contracts");
          return computeFrameBundleDigestV0(reboundArtifact);
        })(),
      };
      await callbacks.onArtifactReady(finalized);
      await callbacks.onCaptureState("artifact_ready");
      await callbacks.onCaptureState("cleaning_up");
      await callbacks.onComplete();
    })();
  }

  stop(): void { this.stops += 1; }
  clearTransientMedia(): void { this.clears += 1; }
  unmount(): void { this.stop(); this.clearTransientMedia(); }
  async wait(): Promise<void> { await this.pending; }
}

describe("browser admission and controller composition", () => {
  test.each([15, 16, 17])("freezes iOS %i Safari and Chrome to update-only", (iosMajor) => {
    for (const browser of ["safari", "chrome"] as const) {
      const result = admitBrowserV1(policy, admissionInput(iosMajor, browser));
      expect(result.outcome).toBe("ios_update_required");
      expect(result.mayStartSensitiveFlow).toBe(false);
      expect(result.browser).toBe(browser);
    }
  });

  test("keeps iOS 18+ Safari and Chrome as separate candidates", () => {
    for (const browser of ["safari", "chrome"] as const) {
      const result = admitBrowserV1(policy, admissionInput(18, browser));
      expect(result.outcome).toBe("eligible_candidate");
      expect(result.mayStartSensitiveFlow).toBe(true);
      expect(result.browser).toBe(browser);
    }
  });

  test.each([
    ["insecure", { capabilities: { ...admissionInput(18, "safari").capabilities, secureContext: false } }, "insecure_context"],
    ["framed", { isTopLevel: false, frameOrigin: "cross_origin" as const }, "context_not_top_level"],
    ["embedded", { browserContext: "embedded" as const, embeddedEvidence: "confirmed" as const }, "embedded_browser_handoff"],
    ["private", { browserContext: "private_or_unknown" as const }, "private_or_unknown_context"],
    ["PWA", { browserContext: "installed_pwa" as const }, "private_or_unknown_context"],
  ] as const)("rejects %s contexts before sensitive work", (_name, overrides, expected) => {
    const result = admitBrowserV1(policy, admissionInput(18, "safari", overrides));
    expect(result.outcome).toBe(expected);
    expect(result.mayStartSensitiveFlow).toBe(false);
  });

  test("does not create a session or start capture on the iOS 15-17 route", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    let sessionCreates = 0;
    const capture = new DeterministicMetadataCapture();
    const sessionPort = new Proxy(runtime.browserPort, {
      get(target, property, receiver) {
        if (property === "createSession") {
          return (...args: Parameters<typeof target.createSession>) => {
            sessionCreates += 1;
            return target.createSession(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const decision = admitBrowserV1(policy, admissionInput(17, "safari"));
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort,
      admission: adapter(decision),
      capture,
    });
    controller.start();
    await controller.waitForIdle();
    controller.act("continue");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("admission_update_required");
    expect(sessionCreates).toBe(0);
    expect(capture.starts).toBe(0);
  });

  test.each([
    ["invalid_request", "flow_failed"],
    ["expired", "flow_expired"],
  ] as const)("maps bootstrap %s safely and performs no sensitive work", async (reasonCode, expectedState) => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    let sessionCreates = 0;
    const capture = new DeterministicMetadataCapture();
    const sessionPort = new Proxy(runtime.browserPort, {
      get(target, property, receiver) {
        if (property === "bootstrap") {
          return async () => ({
            kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
            version: SIMULATOR_BROWSER_SESSION_PORT_V0,
            mode: SIMULATION_MODE,
            environment: SIMULATION_ENVIRONMENT,
            operation: "bootstrap" as const,
            reasonCode,
          });
        }
        if (property === "createSession") {
          return (...args: Parameters<typeof target.createSession>) => {
            sessionCreates += 1;
            return target.createSession(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort,
      admission: adapter(admitBrowserV1(policy, admissionInput(18, "safari"))),
      capture,
    });
    controller.start();
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe(expectedState);
    expect(sessionCreates).toBe(0);
    expect(capture.starts).toBe(0);
  });

  test("embedded handoff occurs before session or camera work", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    let sessionCreates = 0;
    let handoffs = 0;
    const capture = new DeterministicMetadataCapture();
    const sessionPort = new Proxy(runtime.browserPort, {
      get(target, property, receiver) {
        if (property === "createSession") {
          return (...args: Parameters<typeof target.createSession>) => {
            sessionCreates += 1;
            return target.createSession(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const embedded = admitBrowserV1(policy, admissionInput(18, "safari", {
      browserContext: "embedded",
      embeddedEvidence: "confirmed",
    }));
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort,
      admission: {
        async evaluate() { return embedded; },
        async openExternalBrowser() { handoffs += 1; },
      },
      capture,
    });
    controller.start();
    await controller.waitForIdle();
    controller.act("continue");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("admission_handoff_required");
    controller.act("open_external_browser");
    await controller.waitForIdle();
    expect(handoffs).toBe(1);
    expect(sessionCreates).toBe(0);
    expect(capture.starts).toBe(0);
  });

  test("drives the eligible happy path through actual server composition using metadata only", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const capture = new DeterministicMetadataCapture();
    const states: string[] = [];
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: runtime.browserPort,
      admission: adapter(admitBrowserV1(policy, admissionInput(18, "safari"))),
      capture,
    });
    controller.subscribe((snapshot) => states.push(snapshot.state));
    controller.start();
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("request_review");
    controller.act("continue");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("admission_safari_candidate");
    controller.act("continue");
    controller.act("start_demo_authenticator");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("demo_authenticator_ready");
    controller.act("continue_to_camera");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("capture_intro");
    controller.act("start_camera");
    expect(controller.snapshot.state).toBe("capture_preview");
    controller.act("collect_frame_metadata");
    await capture.wait();
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("simulated_credential_ready");
    expect(controller.snapshot.authoritativeSessionState).toBe("simulated_credential_ready");
    expect(states).toContain("capture_sampling");
    expect(states).toContain("capture_cleaning");
    expect(states).toContain("capture_complete");
    expect(capture.starts).toBe(1);
    expect(capture.metadataRequests).toBeGreaterThanOrEqual(1);
    expect(capture.stops).toBeGreaterThanOrEqual(1);
    expect(capture.clears).toBeGreaterThanOrEqual(1);
  });

  test("retake rotates the capture key and actual W06/W10 accepts the second submission", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0({
      testConfiguration: {
        kind: "authenticator_server_test_configuration_v0",
        biometricScenario: "capture_retry",
        issuanceScenario: "issue_success",
      },
    });
    const capture = new DeterministicMetadataCapture();
    const submitKeys: string[] = [];
    const submitReasonCodes: string[] = [];
    const sessionPort = new Proxy(runtime.browserPort, {
      get(target, property, receiver) {
        if (property === "submitCapture") {
          return async (input: Parameters<typeof target.submitCapture>[0]) => {
            submitKeys.push(input.idempotencyKey);
            const result = await target.submitCapture(input);
            if (result.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
              submitReasonCodes.push(result.reasonCode);
            }
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort,
      admission: adapter(admitBrowserV1(policy, admissionInput(18, "safari"))),
      capture,
    });

    controller.start();
    await controller.waitForIdle();
    controller.act("continue");
    await controller.waitForIdle();
    controller.act("continue");
    controller.act("start_demo_authenticator");
    await controller.waitForIdle();
    controller.act("continue_to_camera");
    await controller.waitForIdle();
    controller.act("start_camera");
    controller.act("collect_frame_metadata");
    await capture.wait();
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("biometric_simulated_retry");

    controller.act("retake");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("capture_intro");
    controller.act("start_camera");
    controller.act("collect_frame_metadata");
    await capture.wait();
    await controller.waitForIdle();

    expect(controller.snapshot.state).toBe("biometric_simulated_retry");
    expect(submitKeys).toHaveLength(2);
    expect(submitKeys[1]).not.toBe(submitKeys[0]);
    expect(submitReasonCodes).not.toContain("binding_mismatch");
    expect(capture.starts).toBe(2);
  });

  test("recovers a committed W06/W10 result by status after one lost browser response", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0({
      testConfiguration: {
        kind: "authenticator_server_test_configuration_v0",
        biometricScenario: "happy_path",
        issuanceScenario: "issue_success",
      },
    });
    const capture = new DeterministicMetadataCapture();
    let submitCalls = 0;
    let statusCalls = 0;
    let committedState: string | undefined;
    const sessionPort = new Proxy(runtime.browserPort, {
      get(target, property, receiver) {
        if (property === "submitCapture") {
          return async (input: Parameters<typeof target.submitCapture>[0]) => {
            submitCalls += 1;
            const committed = await target.submitCapture(input);
            committedState = committed.kind === "simulator_browser_session_view_v0"
              ? committed.state
              : undefined;
            return {
              kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
              version: SIMULATOR_BROWSER_SESSION_PORT_V0,
              mode: SIMULATION_MODE,
              environment: SIMULATION_ENVIRONMENT,
              operation: "submit_capture" as const,
              reasonCode: "network_unavailable" as const,
            };
          };
        }
        if (property === "getStatus") {
          return (input: Parameters<typeof target.getStatus>[0]) => {
            statusCalls += 1;
            return target.getStatus(input);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort,
      admission: adapter(admitBrowserV1(policy, admissionInput(18, "chrome"))),
      capture,
    });

    controller.start();
    await controller.waitForIdle();
    controller.act("continue");
    await controller.waitForIdle();
    controller.act("continue");
    controller.act("start_demo_authenticator");
    await controller.waitForIdle();
    controller.act("continue_to_camera");
    await controller.waitForIdle();
    controller.act("start_camera");
    controller.act("collect_frame_metadata");
    await capture.wait();
    await controller.waitForIdle();

    expect(committedState).toBe("simulated_credential_ready");
    expect(controller.snapshot.state).toBe("session_error");
    expect(controller.snapshot.detailCode).toBe("network_unavailable");
    expect(controller.snapshot.authoritativeSessionState).toBe("capture_ready");
    expect(submitCalls).toBe(1);

    expect(controller.act("query_status")).toBe(true);
    await controller.waitForIdle();
    expect(statusCalls).toBe(1);
    expect(controller.snapshot.state).toBe("simulated_credential_ready");
    expect(controller.snapshot.authoritativeSessionState).toBe("simulated_credential_ready");
    expect(submitCalls).toBe(1);
    expect(capture.starts).toBe(1);
  });
});
