import { describe, expect, test } from "bun:test";
import {
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  assertSimulationArtifactAllowed,
  assertSimulatorBrowserArtifactAllowed,
  type BiometricSimulationScenarioV0,
  type EnrollmentSessionStateV2,
  type IssuanceSimulationScenarioV0,
} from "@clean-start/contracts";
import { AUTHENTICATOR_APP_CONFIG } from "@clean-start/app-config";
import { rejectSimulationArtifactAtProductionBoundary } from "@clean-start/session-gateway";
import { createAuthenticatorHttpHandlerV0 } from "../../../apps/authenticator/src/server/http.server";
import { createAuthenticatorServerRuntimeV0 } from "../../../apps/authenticator/src/server/runtime.server";
import { completeScenario, metadataBundle, prepareScenario } from "../testkit/runtime";

const expectedState: Readonly<Record<
  BiometricSimulationScenarioV0,
  Readonly<Record<IssuanceSimulationScenarioV0, EnrollmentSessionStateV2>>
>> = Object.freeze({
  happy_path: Object.freeze({
    issue_success: "simulated_credential_ready",
    issue_reject: "simulated_issuance_reject",
    issue_unavailable: "simulated_issuance_unavailable",
  }),
  spoof_reject: Object.freeze({
    issue_success: "simulated_reject",
    issue_reject: "simulated_reject",
    issue_unavailable: "simulated_reject",
  }),
  capture_retry: Object.freeze({
    issue_success: "simulated_retry",
    issue_reject: "simulated_retry",
    issue_unavailable: "simulated_retry",
  }),
  dependency_unavailable: Object.freeze({
    issue_success: "simulated_unavailable",
    issue_reject: "simulated_unavailable",
    issue_unavailable: "simulated_unavailable",
  }),
});

function request(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${AUTHENTICATOR_APP_CONFIG.publicOrigin}${path}`, {
    method: "POST",
    headers: {
      origin: AUTHENTICATOR_APP_CONFIG.publicOrigin,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("actual W06/W10 composition and browser boundary", () => {
  for (const biometric of [
    "happy_path",
    "spoof_reject",
    "capture_retry",
    "dependency_unavailable",
  ] as const) {
    for (const issuance of [
      "issue_success",
      "issue_reject",
      "issue_unavailable",
    ] as const) {
      test(`${biometric} x ${issuance} has the server-owned outcome`, async () => {
        const completed = await completeScenario(biometric, issuance);
        expect(completed.result.kind).toBe(SIMULATOR_BROWSER_SESSION_VIEW_V0);
        if (completed.result.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) return;
        expect(completed.result.state).toBe(expectedState[biometric][issuance]);
        const serialized = JSON.stringify(completed.result);
        expect(serialized).not.toContain("biometricScenario");
        expect(serialized).not.toContain("issuanceScenario");
        expect(serialized).not.toContain("signatureBase64Url");
        expect(serialized).not.toContain("receiptId");
        expect(serialized).not.toContain("credentialId");
        if (completed.result.state === "simulated_credential_ready") {
          expect(completed.result.artifactSummary).toEqual({
            kind: "simulated_workflow_artifact_summary_v0",
            biometricVerification: "not_performed",
            uniqueness: "not_performed",
            credentialClass: "not_selfie_check",
            productionCredential: false,
          });
        } else {
          expect(completed.result.artifactSummary).toBeNull();
        }
      });
    }
  }

  test("replays an exact submit idempotently and rejects nonce or artifact rebinding", async () => {
    const completed = await completeScenario("happy_path", "issue_success", "replay-evidence");
    const replay = await completed.browserPort.submitCapture(completed.submitInput);
    expect(replay).toEqual(completed.result);

    const otherKey = await completed.browserPort.submitCapture({
      ...completed.submitInput,
      idempotencyKey: "capture-replay-other-key",
    });
    expect(otherKey.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (otherKey.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(["replay_rejected", "binding_mismatch"]).toContain(otherKey.reasonCode);
    }

    const otherNonce = await completed.browserPort.submitCapture({
      ...completed.submitInput,
      nonceBase64Url: `${completed.submitInput.nonceBase64Url}x`,
    });
    expect(otherNonce.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (otherNonce.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(otherNonce.reasonCode).toBe("binding_mismatch");
    }

    const reboundBundle = {
      ...completed.submitInput.frameBundle,
      artifactDigestSha256: "f".repeat(64),
    };
    const otherArtifact = await completed.browserPort.submitCapture({
      ...completed.submitInput,
      frameBundle: reboundBundle,
    });
    expect(otherArtifact.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (otherArtifact.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(otherArtifact.reasonCode).toBe("binding_mismatch");
    }
  });

  test("rejects cross-session handles and bound demo completion tampering", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const first = await runtime.browserPort.createSession({ idempotencyKey: "binding-first" });
    const second = await runtime.browserPort.createSession({ idempotencyKey: "binding-second" });
    if (
      first.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0 ||
      second.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0
    ) throw new Error("create_failed");

    const crossed = await runtime.browserPort.getStatus({
      sessionId: first.sessionId,
      browserHandle: second.browserHandle,
    });
    expect(crossed.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (crossed.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(crossed.reasonCode).toBe("unauthorized");
    }

    const ready = await runtime.browserPort.beginDemoAuthenticator({
      sessionId: first.sessionId,
      browserHandle: first.browserHandle,
      idempotencyKey: "binding-demo",
    });
    expect(ready.kind).toBe(SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0);
    if (ready.kind !== SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0) return;
    const tampered = await runtime.browserPort.completeDemoAuthenticator({
      sessionId: first.sessionId,
      browserHandle: first.browserHandle,
      idempotencyKey: ready.idempotencyKey,
      completionHandle: `${ready.completionHandle.slice(0, -1)}x`,
    });
    expect(tampered.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (tampered.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(tampered.reasonCode).toBe("binding_mismatch");
    }
  });

  test("accepts return only after a server-observed terminal state", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const created = await runtime.browserPort.createSession({ idempotencyKey: "return-live" });
    if (created.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("create_failed");
    const early = await runtime.browserPort.returnToRp({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
    });
    expect(early.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (early.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(early.reasonCode).toBe("invalid_state");
    }

    const completed = await completeScenario("spoof_reject", "issue_success", "return-terminal");
    if (completed.result.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) {
      throw new Error("terminal_scenario_failed");
    }
    const accepted = await completed.browserPort.returnToRp({
      sessionId: completed.result.sessionId,
      browserHandle: completed.result.browserHandle,
    });
    expect(accepted.kind).toBe(SIMULATOR_BROWSER_RETURN_ACCEPTED_V0);
  });

  test("HTTP rejects scenario injection, raw media shapes, cross-origin, and invalid bodies", async () => {
    const prepared = await prepareScenario("happy_path", "issue_success", "http-raw-media");
    const handle = createAuthenticatorHttpHandlerV0(prepared.browserPort);
    const scenario = await handle(request("/api/v0/session/create", {
      idempotencyKey: "scenario-injection",
      biometricScenario: "happy_path",
    }));
    expect(scenario.status).toBe(400);

    const validBundle = await metadataBundle(
      prepared.captureReady,
      prepared.bootstrap.accountPublicMaterialDigestSha256,
    );
    const rawMedia = await handle(request("/api/v0/session/capture/submit", {
      sessionId: prepared.captureReady.sessionId,
      browserHandle: prepared.captureReady.browserHandle,
      idempotencyKey: "raw-media",
      nonceBase64Url: prepared.captureReady.nonceBase64Url,
      frameBundle: {
        ...validBundle,
        frames: [{ ...validBundle.frames[0], pixels: "data:image/png;base64,AAAA" }],
      },
    }));
    expect(rawMedia.status).toBe(400);

    const hostileOrigin = await handle(request("/api/v0/bootstrap", {}, {
      origin: "https://attacker.invalid",
    }));
    expect(hostileOrigin.status).toBe(403);

    const wrongType = await handle(new Request(
      `${AUTHENTICATOR_APP_CONFIG.publicOrigin}/api/v0/bootstrap`,
      {
        method: "POST",
        headers: {
          origin: AUTHENTICATOR_APP_CONFIG.publicOrigin,
          "content-type": "text/plain",
        },
        body: "{}",
      },
    ));
    expect(wrongType.status).toBe(415);
  });

  test("browser-visible artifacts and gateway artifacts reject production before nested reads", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => assertSimulationArtifactAllowed("production", revoked.proxy)).toThrow(
      "Simulation artifacts are forbidden in production",
    );
    expect(() => assertSimulatorBrowserArtifactAllowed("production", revoked.proxy)).toThrow(
      "Simulation artifacts are forbidden in production",
    );
    expect(() => rejectSimulationArtifactAtProductionBoundary("production", revoked.proxy)).toThrow(
      "Simulation artifacts are forbidden in production",
    );
  });

  test("only accepts one or two ordered metadata descriptors at the HTTP boundary", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const bootstrap = await runtime.browserPort.bootstrap();
    const created = await runtime.browserPort.createSession({ idempotencyKey: "bounds-create" });
    if (
      bootstrap.kind !== "simulator_ui_bootstrap_v0" ||
      created.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0
    ) throw new Error("setup_failed");
    const demo = await runtime.browserPort.beginDemoAuthenticator({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
      idempotencyKey: "bounds-demo",
    });
    if (demo.kind !== SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0) throw new Error("demo_failed");
    const complete = await runtime.browserPort.completeDemoAuthenticator({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
      idempotencyKey: demo.idempotencyKey,
      completionHandle: demo.completionHandle,
    });
    if (complete.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("complete_failed");
    const ready = await runtime.browserPort.prepareCapture({
      sessionId: complete.sessionId,
      browserHandle: complete.browserHandle,
    });
    if (ready.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("prepare_failed");
    const valid = await metadataBundle(ready, bootstrap.accountPublicMaterialDigestSha256);
    expect(valid.frames).toHaveLength(1);
    expect(valid.dataMode).toBe("metadata_only");
    const invalid = await runtime.browserPort.submitCapture({
      sessionId: ready.sessionId,
      browserHandle: ready.browserHandle,
      idempotencyKey: "bounds-submit",
      nonceBase64Url: ready.nonceBase64Url,
      frameBundle: { ...valid, frames: [] },
    });
    expect(invalid.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (invalid.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(invalid.reasonCode).toBe("artifact_invalid");
    }
  });
});
