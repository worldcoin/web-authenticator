import { describe, expect, test } from "bun:test";
import {
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  SIMULATOR_UI_BOOTSTRAP_V0,
  computeFrameBundleDigestV0,
  type BiometricSimulationScenarioV0,
  type FrameBundleV0,
  type IssuanceSimulationScenarioV0,
  type SimulatorBrowserSessionViewV0,
} from "@clean-start/contracts";
import { createAuthenticatorServerRuntimeV0 } from "../src/server/runtime.server";

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function metadataBundle(
  session: SimulatorBrowserSessionViewV0,
  accountDigest: string,
): Promise<FrameBundleV0> {
  const pending: FrameBundleV0 = {
    kind: FRAME_BUNDLE_V0,
    mode: SIMULATION_MODE,
    sessionId: session.sessionId,
    policyId: session.capturePolicy.policyId,
    accountPublicMaterialDigestSha256: accountDigest,
    nonceDigestSha256: await sha256Text(session.nonceBase64Url),
    dataMode: "metadata_only",
    frames: [{
      transportIndex: 0,
      width: 1,
      height: 1,
      encoding: "rgba8",
      byteLength: 4,
      frameDigestSha256: "a".repeat(64),
    }],
    totalByteLength: 4,
    digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
    artifactDigestSha256: "0".repeat(64),
  };
  return { ...pending, artifactDigestSha256: await computeFrameBundleDigestV0(pending) };
}

async function runScenario(
  biometricScenario: BiometricSimulationScenarioV0,
  issuanceScenario: IssuanceSimulationScenarioV0,
) {
  const runtime = await createAuthenticatorServerRuntimeV0({
    testConfiguration: {
      kind: "authenticator_server_test_configuration_v0",
      biometricScenario,
      issuanceScenario,
    },
  });
  const bootstrap = await runtime.browserPort.bootstrap();
  expect(bootstrap.kind).toBe(SIMULATOR_UI_BOOTSTRAP_V0);
  if (bootstrap.kind !== SIMULATOR_UI_BOOTSTRAP_V0) throw new Error("bootstrap failed");

  const created = await runtime.browserPort.createSession({ idempotencyKey: `create-${biometricScenario}-${issuanceScenario}` });
  expect(created.kind).toBe(SIMULATOR_BROWSER_SESSION_VIEW_V0);
  if (created.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("create failed");

  const demo = await runtime.browserPort.beginDemoAuthenticator({
    sessionId: created.sessionId,
    browserHandle: created.browserHandle,
    idempotencyKey: `demo-${biometricScenario}-${issuanceScenario}`,
  });
  expect(demo.kind).toBe(SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0);
  if (demo.kind !== SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0) throw new Error("demo failed");

  const completed = await runtime.browserPort.completeDemoAuthenticator({
    sessionId: created.sessionId,
    browserHandle: created.browserHandle,
    idempotencyKey: demo.idempotencyKey,
    completionHandle: demo.completionHandle,
  });
  if (completed.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("complete failed");
  const captureReady = await runtime.browserPort.prepareCapture({
    sessionId: completed.sessionId,
    browserHandle: completed.browserHandle,
  });
  if (captureReady.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("prepare failed");
  const result = await runtime.browserPort.submitCapture({
    sessionId: captureReady.sessionId,
    browserHandle: captureReady.browserHandle,
    idempotencyKey: `capture-${biometricScenario}-${issuanceScenario}`,
    nonceBase64Url: captureReady.nonceBase64Url,
    frameBundle: await metadataBundle(captureReady, bootstrap.accountPublicMaterialDigestSha256),
  });
  return { runtime, result };
}

describe("server-only real W06/W10 composition", () => {
  test("uses five distinct Ed25519 public keys plus a separate HMAC handle key", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    expect(runtime.keyReadiness.ed25519PublicFingerprints).toHaveLength(5);
    expect(new Set(runtime.keyReadiness.ed25519PublicFingerprints).size).toBe(5);
    expect(runtime.keyReadiness.handleKeyAlgorithm).toBe("HMAC");
  });

  test.each([
    ["happy_path", "issue_success", "simulated_credential_ready"],
    ["happy_path", "issue_reject", "simulated_issuance_reject"],
    ["happy_path", "issue_unavailable", "simulated_issuance_unavailable"],
    ["spoof_reject", "issue_success", "simulated_reject"],
    ["spoof_reject", "issue_reject", "simulated_reject"],
    ["spoof_reject", "issue_unavailable", "simulated_reject"],
    ["capture_retry", "issue_success", "simulated_retry"],
    ["capture_retry", "issue_reject", "simulated_retry"],
    ["capture_retry", "issue_unavailable", "simulated_retry"],
    ["dependency_unavailable", "issue_success", "simulated_unavailable"],
    ["dependency_unavailable", "issue_reject", "simulated_unavailable"],
    ["dependency_unavailable", "issue_unavailable", "simulated_unavailable"],
  ] as const)("maps %s / %s to %s without exposing an artifact body", async (biometric, issuance, expectedState) => {
    const { result } = await runScenario(biometric, issuance);
    expect(result.kind).toBe(SIMULATOR_BROWSER_SESSION_VIEW_V0);
    if (result.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("submit failed");
    expect(result.state).toBe(expectedState);
    expect(Object.keys(result)).not.toContain("credential");
    expect(Object.keys(result)).not.toContain("receipt");
  });

  test("replays one opaque demo completion result exactly until expiry", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const created = await runtime.browserPort.createSession({ idempotencyKey: "create-replay" });
    if (created.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("create failed");
    const input = {
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
      idempotencyKey: "demo-replay",
    };
    const first = await runtime.browserPort.beginDemoAuthenticator(input);
    const second = await runtime.browserPort.beginDemoAuthenticator(input);
    expect(first).toEqual(second);
    expect(first.kind).toBe(SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0);
    if (first.kind === SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0) {
      expect(first.completionHandle).not.toContain(created.sessionId);
      expect(first.claims).toEqual({
        webauthnPerformed: false,
        prfEvaluated: false,
        worldIdCreated: false,
      });
    }
  });

  test("rejects a completion handle replayed with a changed issuing idempotency key", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const created = await runtime.browserPort.createSession({ idempotencyKey: "create-binding" });
    if (created.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("create failed");
    const ready = await runtime.browserPort.beginDemoAuthenticator({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
      idempotencyKey: "demo-original",
    });
    if (ready.kind !== SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0) throw new Error("demo failed");
    const changed = await runtime.browserPort.completeDemoAuthenticator({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
      idempotencyKey: "demo-changed",
      completionHandle: ready.completionHandle,
    });
    expect(changed.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (changed.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(changed.reasonCode).toBe("binding_mismatch");
    }
    const tampered = await runtime.browserPort.completeDemoAuthenticator({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
      idempotencyKey: ready.idempotencyKey,
      completionHandle: `${ready.completionHandle.slice(0, -1)}x`,
    });
    expect(tampered.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (tampered.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(tampered.reasonCode).toBe("binding_mismatch");
    }
    const status = await runtime.browserPort.getStatus({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
    });
    expect(status.kind).toBe(SIMULATOR_BROWSER_SESSION_VIEW_V0);
    if (status.kind === SIMULATOR_BROWSER_SESSION_VIEW_V0) expect(status.state).toBe("created");
  });

  test("rejects return for a fresh live session but accepts explicit terminal outcomes", async () => {
    const freshRuntime = await createAuthenticatorServerRuntimeV0();
    const fresh = await freshRuntime.browserPort.createSession({ idempotencyKey: "fresh-return" });
    if (fresh.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("create failed");
    const early = await freshRuntime.browserPort.returnToRp({
      sessionId: fresh.sessionId,
      browserHandle: fresh.browserHandle,
    });
    expect(early.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (early.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(early.reasonCode).toBe("invalid_state");
    }

    const { runtime, result } = await runScenario("spoof_reject", "issue_success");
    if (result.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("scenario failed");
    const accepted = await runtime.browserPort.returnToRp({
      sessionId: result.sessionId,
      browserHandle: result.browserHandle,
    });
    expect(accepted.kind).toBe(SIMULATOR_BROWSER_RETURN_ACCEPTED_V0);

    const cancelledRuntime = await createAuthenticatorServerRuntimeV0();
    const cancellable = await cancelledRuntime.browserPort.createSession({
      idempotencyKey: "cancelled-return",
    });
    if (cancellable.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("create failed");
    const cancelled = await cancelledRuntime.browserPort.cancel({
      sessionId: cancellable.sessionId,
      browserHandle: cancellable.browserHandle,
    });
    if (cancelled.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("cancel failed");
    const cancelledReturn = await cancelledRuntime.browserPort.returnToRp({
      sessionId: cancelled.sessionId,
      browserHandle: cancelled.browserHandle,
    });
    expect(cancelledReturn.kind).toBe(SIMULATOR_BROWSER_RETURN_ACCEPTED_V0);
  });

  test("accepts return after a server-observed terminal demo error", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0({
      testConfiguration: {
        kind: "authenticator_server_test_configuration_v0",
        biometricScenario: "happy_path",
        issuanceScenario: "issue_success",
        demoAuthenticatorOutcome: "unavailable",
      },
    });
    const created = await runtime.browserPort.createSession({ idempotencyKey: "demo-exit-create" });
    if (created.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("create failed");
    const unavailable = await runtime.browserPort.beginDemoAuthenticator({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
      idempotencyKey: "demo-exit",
    });
    expect(unavailable.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    const accepted = await runtime.browserPort.returnToRp({
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
    });
    expect(accepted.kind).toBe(SIMULATOR_BROWSER_RETURN_ACCEPTED_V0);
  });
});
