import { describe, expect, test } from "bun:test";
import type { BrowserAdmissionDecisionV1 } from "@clean-start/browser-admission";
import {
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0,
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  SIMULATOR_UI_BOOTSTRAP_V0,
  SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
  SIMULATOR_UI_QUALITY_POLICY_V0,
  makeAuthenticatorUiSnapshotV1,
  type BrowserIdempotentSessionFieldsV0,
  type BrowserSessionFieldsV0,
  type CompleteDemoAuthenticatorV0,
  type CreateSimulatorBrowserSessionV0,
  type SimulatorBrowserSessionViewV0,
  type SimulatorBrowserSessionResultV0,
  type SimulatorUiBootstrapV0,
  type SubmitSimulatorCaptureV0,
  type FrameBundleV0,
} from "@clean-start/contracts";
import type {
  BrowserCaptureAdapterV1,
  BrowserCaptureCallbacksV1,
  BrowserCaptureStartV1,
} from "../src/adapters/browser-capture";
import type { BrowserAdmissionAdapterV1 } from "../src/adapters/browser-admission";
import type { AbortableSimulatorBrowserSessionPortV0 } from "../src/adapters/http-session";
import { AuthenticatorFlowControllerV1 } from "../src/flow/controller";

const expiresAt = "2030-01-01T00:00:00.000Z";
const capturePolicy = { ...SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0, expiresAt };

function session(
  state: SimulatorBrowserSessionViewV0["state"],
  code: SimulatorBrowserSessionViewV0["code"],
  nonceBase64Url = "nonce",
): SimulatorBrowserSessionViewV0 {
  return {
    kind: SIMULATOR_BROWSER_SESSION_VIEW_V0,
    version: SIMULATOR_BROWSER_SESSION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    sessionId: "session",
    browserHandle: "browser-handle",
    nonceBase64Url,
    state,
    code,
    retryable: code === "simulation_retry" || code === "simulation_unavailable" || code === "issuance_unavailable",
    expiresAt,
    capturePolicy,
    artifactSummary: state === "simulated_credential_ready" ? {
      kind: SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0,
      biometricVerification: "not_performed",
      uniqueness: "not_performed",
      credentialClass: "not_selfie_check",
      productionCredential: false,
    } : null,
  };
}

class FakeSessionPort implements AbortableSimulatorBrowserSessionPortV0 {
  returnCalls = 0;
  createCalls = 0;
  cancelCalls = 0;

  async bootstrap(): Promise<SimulatorUiBootstrapV0> {
    return {
      kind: SIMULATOR_UI_BOOTSTRAP_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      rpPresentationId: "zoom_demo" as const,
      accountPublicMaterialDigestSha256: "0".repeat(64),
      returnAction: "server_managed" as const,
      authenticator: {
        kind: "injected_demo_only" as const,
        webauthnPerformed: false as const,
        prfEvaluated: false as const,
        worldIdCreated: false as const,
      },
      qualityPolicy: SIMULATOR_UI_QUALITY_POLICY_V0,
    };
  }
  async createSession(_input: CreateSimulatorBrowserSessionV0): Promise<SimulatorBrowserSessionResultV0> {
    this.createCalls += 1;
    return session("created", "created");
  }
  async beginDemoAuthenticator(input: BrowserIdempotentSessionFieldsV0) {
    return {
      kind: SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      completionHandle: "completion-handle",
      claims: {
        webauthnPerformed: false as const,
        prfEvaluated: false as const,
        worldIdCreated: false as const,
      },
      expiresAt,
    };
  }
  async completeDemoAuthenticator(_input: CompleteDemoAuthenticatorV0) {
    return session("passkey_complete", "passkey_complete");
  }
  async prepareCapture(_input: BrowserSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0> {
    return session("capture_ready", "capture_ready");
  }
  async submitCapture(_input: SubmitSimulatorCaptureV0): Promise<SimulatorBrowserSessionResultV0> {
    return session("simulated_credential_ready", "simulated_credential_ready");
  }
  async retryUnavailable(_input: BrowserIdempotentSessionFieldsV0) {
    return session("simulated_credential_ready", "simulated_credential_ready");
  }
  async getStatus(_input: BrowserSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0> {
    return session("capture_ready", "capture_ready");
  }
  async cancel(_input: BrowserSessionFieldsV0) {
    this.cancelCalls += 1;
    return session("cancelled", "cancelled");
  }
  async returnToRp(_input: BrowserSessionFieldsV0) {
    this.returnCalls += 1;
    return {
      kind: SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      action: "server_managed" as const,
    };
  }
}

function admission(outcome: "eligible_candidate" | "ios_update_required" = "eligible_candidate"): BrowserAdmissionDecisionV1 {
  return {
    version: "browser_admission_v1",
    outcome,
    reason: outcome === "eligible_candidate" ? "candidate_only_ceremony_required" : "ios_version_requires_update",
    mayStartSensitiveFlow: outcome === "eligible_candidate",
    browser: "safari",
    iosVersionBand: outcome === "eligible_candidate" ? "ios_18_plus" : "ios_15_17",
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
}

function captureAdapter(order: string[] = []): BrowserCaptureAdapterV1 {
  return {
    start() { order.push("start_capture"); },
    requestMetadataCollection() { order.push("collect_frame_metadata"); },
    stop() { order.push("stop_capture"); },
    clearTransientMedia() { order.push("clear_transient_media"); },
    unmount() { order.push("unmount"); },
  };
}

function admissionAdapter(value: BrowserAdmissionDecisionV1): BrowserAdmissionAdapterV1 {
  return {
    async evaluate() { return value; },
    async openExternalBrowser() {},
  };
}

const fakeFrameBundle: FrameBundleV0 = {
  kind: FRAME_BUNDLE_V0,
  mode: SIMULATION_MODE,
  sessionId: "session",
  policyId: capturePolicy.policyId,
  accountPublicMaterialDigestSha256: "0".repeat(64),
  nonceDigestSha256: "1".repeat(64),
  dataMode: "metadata_only",
  frames: [{
    transportIndex: 0,
    width: 1,
    height: 1,
    encoding: "rgba8",
    byteLength: 4,
    frameDigestSha256: "2".repeat(64),
  }],
  totalByteLength: 4,
  digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  artifactDigestSha256: "3".repeat(64),
};

function completingCaptureAdapter(): BrowserCaptureAdapterV1 {
  return {
    start(_input: BrowserCaptureStartV1, callbacks: BrowserCaptureCallbacksV1) {
      void callbacks.onCaptureState("acquiring");
      void callbacks.onCaptureState("awaiting_first_frame");
      void callbacks.onCaptureState("preview");
      void callbacks.onQuality({
        version: "client_quality_policy_v0",
        policyId: SIMULATOR_UI_QUALITY_POLICY_V0.policyId,
        action: "ready",
        reasonCodes: [],
      });
      void callbacks.onArtifactReady(fakeFrameBundle);
      void callbacks.onCaptureState("artifact_ready");
      void callbacks.onCaptureState("cleaning_up");
      void callbacks.onComplete();
    },
    requestMetadataCollection() {},
    stop() {},
    clearTransientMedia() {},
    unmount() {},
  };
}

async function advanceToCaptureIntro(controller: AuthenticatorFlowControllerV1): Promise<void> {
  controller.start();
  await controller.waitForIdle();
  controller.act("continue");
  await controller.waitForIdle();
  controller.act("continue");
  controller.act("start_demo_authenticator");
  await controller.waitForIdle();
  controller.act("continue_to_camera");
  await controller.waitForIdle();
  expect(controller.snapshot.state).toBe("capture_intro");
}

describe("flow controller", () => {
  test("runs bootstrap, real admission, demo session, and capture preparation from frozen effects", async () => {
    const port = new FakeSessionPort();
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: port,
      admission: admissionAdapter(admission()),
      capture: captureAdapter(),
    });
    controller.start();
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("request_review");

    controller.act("continue");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("admission_safari_candidate");
    controller.act("continue");
    expect(controller.snapshot.state).toBe("demo_authenticator_intro");
    controller.act("start_demo_authenticator");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("demo_authenticator_ready");
    expect(port.createCalls).toBe(1);

    controller.act("continue_to_camera");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("capture_intro");
  });

  test("invokes zero session or capture work for iOS 15-17", async () => {
    const port = new FakeSessionPort();
    const order: string[] = [];
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: port,
      admission: admissionAdapter(admission("ios_update_required")),
      capture: captureAdapter(order),
    });
    controller.start();
    await controller.waitForIdle();
    controller.act("continue");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("admission_update_required");
    expect(port.createCalls).toBe(0);
    expect(order).toEqual([]);
  });

  test("runs abort, stop, clear, then session cancel in exact order", async () => {
    const port = new FakeSessionPort();
    const order: string[] = [];
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: port,
      admission: admissionAdapter(admission()),
      capture: captureAdapter(order),
      initialSnapshot: makeAuthenticatorUiSnapshotV1({
        state: "capture_sampling",
        authoritativeSessionState: "capture_ready",
        rpPresentationId: "zoom_demo",
        visualSource: "figma_5132_134841",
      }),
      initialSession: session("capture_ready", "capture_ready"),
      onEffect(effect) { order.push(effect); },
    });
    controller.act("cancel");
    await controller.waitForIdle();
    expect(order.slice(0, 6)).toEqual([
      "abort_active_effects",
      "stop_capture",
      "stop_capture",
      "clear_transient_media",
      "clear_transient_media",
      "cancel_session",
    ]);
    expect(port.cancelCalls).toBe(1);
    expect(controller.snapshot.state).toBe("flow_cancelled");
  });

  test("local Close never calls the session return port", async () => {
    const port = new FakeSessionPort();
    let closed = 0;
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: port,
      admission: admissionAdapter(admission()),
      capture: captureAdapter(),
      initialSnapshot: makeAuthenticatorUiSnapshotV1({
        state: "request_invalid",
        visualSource: "verified_template",
      }),
      closeLocally() { closed += 1; },
    });
    controller.act("close");
    await controller.waitForIdle();
    expect(closed).toBe(1);
    expect(port.returnCalls).toBe(0);
    expect(controller.snapshot.state).toBe("flow_closed");
  });

  test("uses the session return port only for an explicit return action", async () => {
    const port = new FakeSessionPort();
    let navigated = 0;
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: port,
      admission: admissionAdapter(admission()),
      capture: captureAdapter(),
      initialSnapshot: makeAuthenticatorUiSnapshotV1({
        state: "simulated_credential_ready",
        authoritativeSessionState: "simulated_credential_ready",
        rpPresentationId: "zoom_demo",
        visualSource: "figma_5132_135104",
      }),
      initialSession: session("simulated_credential_ready", "simulated_credential_ready"),
      navigateReturned() { navigated += 1; },
    });
    controller.act("return_to_rp");
    await controller.waitForIdle();
    expect(port.returnCalls).toBe(1);
    expect(navigated).toBe(1);
    expect(controller.snapshot.state).toBe("returned");
  });

  test("aborts an in-flight pre-session request before local cleanup", async () => {
    class PendingSessionPort extends FakeSessionPort {
      aborted = false;
      override async createSession(
        _input: CreateSimulatorBrowserSessionV0,
        signal?: AbortSignal,
      ): Promise<SimulatorBrowserSessionViewV0> {
        this.createCalls += 1;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            this.aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
    }
    const port = new PendingSessionPort();
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: port,
      admission: admissionAdapter(admission()),
      capture: captureAdapter(),
    });
    controller.start();
    await controller.waitForIdle();
    controller.act("continue");
    await controller.waitForIdle();
    controller.act("continue");
    controller.act("start_demo_authenticator");
    expect(controller.snapshot.state).toBe("session_creating");
    controller.act("cancel");
    await controller.waitForIdle();
    expect(port.aborted).toBe(true);
    expect(controller.snapshot.state).toBe("flow_cancelled");
  });

  test("does not replace active session A with a valid projection for session B", async () => {
    class CrossSessionPort extends FakeSessionPort {
      override async getStatus(_input: BrowserSessionFieldsV0) {
        return {
          ...session("capture_ready", "capture_ready"),
          sessionId: "session-b",
          browserHandle: "handle-b",
        };
      }
    }
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: new CrossSessionPort(),
      admission: admissionAdapter(admission()),
      capture: captureAdapter(),
      initialSnapshot: makeAuthenticatorUiSnapshotV1({
        state: "biometric_simulated_unavailable",
        authoritativeSessionState: "simulated_unavailable",
        rpPresentationId: "zoom_demo",
        visualSource: "not_figma_verified",
      }),
      initialSession: session("simulated_unavailable", "simulation_unavailable"),
    });
    controller.act("query_status");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("session_error");
    expect(controller.snapshot.detailCode).toBe("response_invalid");
  });

  test("rejects demo-ready output whose session and idempotency do not match the request", async () => {
    class CrossDemoPort extends FakeSessionPort {
      override async beginDemoAuthenticator(_input: BrowserIdempotentSessionFieldsV0) {
        return {
          kind: SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
          version: SIMULATOR_BROWSER_SESSION_PORT_V0,
          mode: SIMULATION_MODE,
          environment: SIMULATION_ENVIRONMENT,
          sessionId: "session-b",
          idempotencyKey: "demo-b",
          completionHandle: "completion-b",
          claims: {
            webauthnPerformed: false as const,
            prfEvaluated: false as const,
            worldIdCreated: false as const,
          },
          expiresAt,
        };
      }
    }
    const retryController = new AuthenticatorFlowControllerV1({
      sessionPort: new CrossDemoPort(),
      admission: admissionAdapter(admission()),
      capture: captureAdapter(),
      initialSnapshot: makeAuthenticatorUiSnapshotV1({
        state: "demo_authenticator_non_completion",
        authoritativeSessionState: "created",
        rpPresentationId: "zoom_demo",
        visualSource: "figma_5132_134488",
      }),
      initialSession: session("created", "created"),
    });
    retryController.act("try_again");
    await retryController.waitForIdle();
    expect(retryController.snapshot.state).toBe("demo_authenticator_invalid_response");
  });

  test("rotates capture idempotency only after an accepted retake nonce changes", async () => {
    class RetakePort extends FakeSessionPort {
      prepareCalls = 0;
      submitKeys: string[] = [];

      override async prepareCapture(_input: BrowserSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0> {
        this.prepareCalls += 1;
        return session(
          "capture_ready",
          "capture_ready",
          this.prepareCalls === 1 ? "nonce-one" : "nonce-two",
        );
      }

      override async submitCapture(input: SubmitSimulatorCaptureV0): Promise<SimulatorBrowserSessionResultV0> {
        this.submitKeys.push(input.idempotencyKey);
        return this.submitKeys.length === 1
          ? session("simulated_retry", "simulation_retry", "nonce-one")
          : session("simulated_credential_ready", "simulated_credential_ready", "nonce-two");
      }
    }
    const port = new RetakePort();
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: port,
      admission: admissionAdapter(admission()),
      capture: completingCaptureAdapter(),
    });
    await advanceToCaptureIntro(controller);
    controller.act("start_camera");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("biometric_simulated_retry");
    controller.act("retake");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("capture_intro");
    controller.act("start_camera");
    await controller.waitForIdle();
    expect(port.submitKeys).toHaveLength(2);
    expect(port.submitKeys[1]).not.toBe(port.submitKeys[0]);
  });

  test("keeps capture idempotency stable across network recovery with the same nonce", async () => {
    class RecoveryPort extends FakeSessionPort {
      submitKeys: string[] = [];
      statusCalls = 0;

      override async prepareCapture(_input: BrowserSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0> {
        return session("capture_ready", "capture_ready", "stable-nonce");
      }

      override async submitCapture(input: SubmitSimulatorCaptureV0): Promise<SimulatorBrowserSessionResultV0> {
        this.submitKeys.push(input.idempotencyKey);
        if (this.submitKeys.length === 1) {
          return {
            kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
            version: SIMULATOR_BROWSER_SESSION_PORT_V0,
            mode: SIMULATION_MODE,
            environment: SIMULATION_ENVIRONMENT,
            operation: "submit_capture",
            reasonCode: "network_unavailable",
          };
        }
        return session("simulated_credential_ready", "simulated_credential_ready", "stable-nonce");
      }

      override async getStatus(_input: BrowserSessionFieldsV0): Promise<SimulatorBrowserSessionResultV0> {
        this.statusCalls += 1;
        return session("capture_ready", "capture_ready", "stable-nonce");
      }
    }
    const port = new RecoveryPort();
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: port,
      admission: admissionAdapter(admission()),
      capture: completingCaptureAdapter(),
    });
    await advanceToCaptureIntro(controller);
    controller.act("start_camera");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("session_error");
    expect(controller.snapshot.detailCode).toBe("network_unavailable");
    controller.act("query_status");
    await controller.waitForIdle();
    expect(port.statusCalls).toBe(1);
    expect(controller.snapshot.state).toBe("capture_intro");
    controller.act("start_camera");
    await controller.waitForIdle();
    expect(port.submitKeys).toHaveLength(2);
    expect(port.submitKeys[1]).toBe(port.submitKeys[0]);
  });

  test("keeps create-session network failure local and terminal", async () => {
    class CreateFailurePort extends FakeSessionPort {
      override async createSession(_input: CreateSimulatorBrowserSessionV0): Promise<SimulatorBrowserSessionResultV0> {
        this.createCalls += 1;
        return {
          kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
          version: SIMULATOR_BROWSER_SESSION_PORT_V0,
          mode: SIMULATION_MODE,
          environment: SIMULATION_ENVIRONMENT,
          operation: "create_session",
          reasonCode: "network_unavailable",
        };
      }
    }
    const controller = new AuthenticatorFlowControllerV1({
      sessionPort: new CreateFailurePort(),
      admission: admissionAdapter(admission()),
      capture: completingCaptureAdapter(),
    });
    controller.start();
    await controller.waitForIdle();
    controller.act("continue");
    await controller.waitForIdle();
    controller.act("continue");
    controller.act("start_demo_authenticator");
    await controller.waitForIdle();
    expect(controller.snapshot.state).toBe("flow_failed");
    expect(controller.snapshot.authoritativeSessionState).toBeNull();
  });
});
