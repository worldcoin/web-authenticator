import { describe, expect, test } from "bun:test";
import { SIMULATION_CAPTURE_POLICY_V0, SIMULATION_ENVIRONMENT, SIMULATION_MODE, validateFrameBundleV0 } from "../../../packages/contracts/src";
import { GatewayErrorV0, type GatewayErrorCodeV0 } from "../src";
import { ACCOUNT_DIGEST, CONTEXT, createBody, makeBundle, makeHarness, MutableClock, reachCaptureReady, submitReady } from "./helpers";

async function expectCode(operation: Promise<unknown>, code: GatewayErrorCodeV0): Promise<void> {
  try {
    await operation;
    throw new Error("expected gateway rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayErrorV0);
    expect((error as GatewayErrorV0).code).toBe(code);
    expect((error as GatewayErrorV0).message).toBe(code);
  }
}

describe("session lifecycle and authenticated browser handle", () => {
  test("creates a short-lived staging session with random identifiers and server-owned scenarios", async () => {
    const firstHarness = await makeHarness();
    const secondHarness = await makeHarness();
    const first = await firstHarness.gateway.createSession(createBody(), CONTEXT);
    const second = await secondHarness.gateway.createSession(createBody(), CONTEXT);

    expect(first.session.state).toBe("created");
    expect(first.session.mode).toBe("simulation");
    expect(first.session.environment).toBe("staging");
    expect(first.session.biometricScenario).toBe("happy_path");
    expect(first.session.sessionId).not.toBe(second.session.sessionId);
    expect(first.session.nonceBase64Url).not.toBe(second.session.nonceBase64Url);
    expect(first.browserHandle).not.toContain(first.session.sessionId);
    expect(Date.parse(first.session.expiresAt) - Date.parse(first.session.createdAt)).toBe(60_000);
  });

  test("replays creation idempotently but rejects reuse against different account binding", async () => {
    const { gateway } = await makeHarness();
    const first = await gateway.createSession(createBody(), CONTEXT);
    const replay = await gateway.createSession(createBody(), CONTEXT);
    expect(replay.session).toEqual(first.session);
    expect(replay.browserHandle).toBe(first.browserHandle);
    await expectCode(gateway.createSession({ ...createBody(), accountId: "other-account" }, CONTEXT), "binding_mismatch");
  });

  test("singleflights concurrent creation by RP, idempotency key, and binding digest", async () => {
    let announceStarted: (() => void) | undefined;
    let release: (() => void) | undefined;
    let selections = 0;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const harness = await makeHarness({
      scenarioSelector: {
        async select() {
          selections += 1;
          announceStarted?.();
          await held;
          return { biometric: "happy_path", issuance: "issue_success" };
        },
      },
    });
    const first = harness.gateway.createSession(createBody(), CONTEXT);
    await started;
    const duplicate = harness.gateway.createSession(createBody(), CONTEXT);
    await expectCode(harness.gateway.createSession({ ...createBody(), accountId: "other-account" }, CONTEXT), "binding_mismatch");
    expect(selections).toBe(1);
    release?.();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(duplicateResult).toBe(firstResult);
    expect(duplicateResult.session.sessionId).toBe(firstResult.session.sessionId);
    expect(selections).toBe(1);
  });

  test("enforces exact origin, RP, handle authentication, and expiry", async () => {
    const harness = await makeHarness();
    const created = await harness.gateway.createSession(createBody(), CONTEXT);
    await expectCode(harness.gateway.getStatus({ sessionId: created.session.sessionId, browserHandle: created.browserHandle }, { ...CONTEXT, origin: "https://evil.example" }), "origin_forbidden");
    await expectCode(harness.gateway.getStatus({ sessionId: created.session.sessionId, browserHandle: `${created.browserHandle}x` }, CONTEXT), "unauthorized");
    harness.clock.advance(60_000);
    await expectCode(harness.gateway.getStatus({ sessionId: created.session.sessionId, browserHandle: created.browserHandle }, CONTEXT), "expired");
    expect(harness.events.at(-1)?.state).toBe("expired");
  });

  test("requires a valid ceremony and preserves passkey idempotency", async () => {
    const harness = await makeHarness();
    const created = await harness.gateway.createSession(createBody(), CONTEXT);
    const request = { sessionId: created.session.sessionId, browserHandle: created.browserHandle, idempotencyKey: "passkey-key", ceremony: "valid-ceremony" };
    await expectCode(harness.gateway.completePasskey({ ...request, ceremony: "bad" }, CONTEXT), "unauthorized");
    const first = await harness.gateway.completePasskey(request, CONTEXT);
    const replay = await harness.gateway.completePasskey(request, CONTEXT);
    expect(first.session.state).toBe("passkey_complete");
    expect(replay).toEqual(first);
    await expectCode(harness.gateway.completePasskey({ ...request, ceremony: "different-valid-shape" }, CONTEXT), "binding_mismatch");
  });

  test("singleflights passkey completion and rejects conflicting session mutations", async () => {
    let announceStarted: (() => void) | undefined;
    let release: (() => void) | undefined;
    let verifications = 0;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const harness = await makeHarness({
      ceremonyVerifier: {
        async verify(ceremony) {
          verifications += 1;
          announceStarted?.();
          await held;
          return ceremony === "valid-ceremony";
        },
      },
    });
    const created = await harness.gateway.createSession(createBody(), CONTEXT);
    const request = { sessionId: created.session.sessionId, browserHandle: created.browserHandle, idempotencyKey: "passkey", ceremony: "valid-ceremony" };
    const first = harness.gateway.completePasskey(request, CONTEXT);
    await started;
    const duplicate = harness.gateway.completePasskey(request, CONTEXT);
    await expectCode(harness.gateway.completePasskey({ ...request, ceremony: "conflict" }, CONTEXT), "binding_mismatch");
    await expectCode(harness.gateway.cancel({ sessionId: created.session.sessionId, browserHandle: created.browserHandle }, CONTEXT), "binding_mismatch");
    expect(verifications).toBe(1);
    release?.();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(duplicateResult).toBe(firstResult);
    expect(firstResult.session.state).toBe("passkey_complete");
    expect(verifications).toBe(1);
  });

  test("requires authenticated server context for scenario selection", async () => {
    const harness = await makeHarness();
    await expectCode(harness.gateway.createSession(createBody(), { ...CONTEXT, authenticatedServerContext: undefined }), "unauthorized");
  });

  test("allows only frozen transitions and rotates the nonce for an approved retake", async () => {
    const harness = await makeHarness({}, { biometric: "capture_retry", issuance: "issue_success" });
    const { ready } = await reachCaptureReady(harness);
    const result = await submitReady(harness, ready);
    expect(result.session.state).toBe("simulated_retry");
    expect(result.retryable).toBe(true);
    const retake = await harness.gateway.prepareCapture({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle }, CONTEXT);
    expect(retake.session.state).toBe("capture_ready");
    expect(retake.session.nonceBase64Url).not.toBe(ready.session.nonceBase64Url);
    await expectCode(harness.gateway.prepareCapture({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle }, CONTEXT), "invalid_state");
    const secondBundle = await makeBundle(retake.session.sessionId, retake.session.nonceBase64Url);
    await harness.gateway.submitCapture({ sessionId: retake.session.sessionId, browserHandle: retake.browserHandle, idempotencyKey: "capture-two", nonceBase64Url: retake.session.nonceBase64Url, frameBundle: secondBundle }, CONTEXT);
    expect(harness.calls.biometricRequests[1]?.requestId).not.toBe(harness.calls.biometricRequests[0]?.requestId);
    expect(harness.calls.biometricRequests[1]?.idempotencyKey).not.toBe(harness.calls.biometricRequests[0]?.idempotencyKey);
  });
});

describe("strict metadata-only capture boundary", () => {
  test("accepts a canonical metadata bundle and authenticates every downstream binding", async () => {
    const harness = await makeHarness();
    const { ready } = await reachCaptureReady(harness);
    const result = await submitReady(harness, ready);
    expect(result.session.state).toBe("simulated_credential_ready");
    expect(result.credential?.claims.credentialClass).toBe("not_selfie_check");
    expect(harness.calls.biometric).toBe(1);
    expect(harness.calls.issuance).toBe(1);
    const biometric = harness.calls.biometricRequests[0]!;
    const issuance = harness.calls.issuanceRequests[0]!;
    expect(biometric.scenario).toBe("happy_path");
    expect(biometric.sessionId).toBe(ready.session.sessionId);
    expect(biometric.accountPublicMaterialDigestSha256).toBe(ACCOUNT_DIGEST);
    expect(issuance.biometricReceipt.outcome).toBe("simulated_pass");
    expect(issuance.biometricReceipt.authentication.signatureBase64Url.length).toBeGreaterThan(20);
  });

  test("rejects unknown fields, browser scenario override, media values, and arbitrary fixture names", async () => {
    const harness = await makeHarness();
    const { ready } = await reachCaptureReady(harness);
    const bundle = await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url);
    const base = { sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "capture", nonceBase64Url: ready.session.nonceBase64Url, frameBundle: bundle };
    await expectCode(harness.gateway.submitCapture({ ...base, scenario: "spoof_reject" }, CONTEXT), "invalid_request");
    await expectCode(harness.gateway.submitCapture({ ...base, frameBundle: { ...bundle, pixels: "data:image/private;base64,AAAA" } }, CONTEXT), "artifact_invalid");
    const fixture = await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url, "synthetic_fixture");
    const arbitrary = { ...fixture, syntheticFixtureId: "https://example.test/private.mov" };
    arbitrary.artifactDigestSha256 = await (await import("../../../packages/contracts/src")).computeFrameBundleDigestV0(arbitrary);
    await expectCode(harness.gateway.submitCapture({ ...base, idempotencyKey: "capture-fixture", frameBundle: arbitrary }, CONTEXT), "artifact_invalid");
    expect(harness.calls.biometric).toBe(0);
  });

  test("enforces session, account, nonce, policy, digest, dimensions, counts, and byte bindings", async () => {
    const cases: Array<(bundle: Awaited<ReturnType<typeof makeBundle>>) => unknown> = [
      (bundle) => ({ ...bundle, sessionId: "wrong" }),
      (bundle) => ({ ...bundle, accountPublicMaterialDigestSha256: "d".repeat(64) }),
      (bundle) => ({ ...bundle, nonceDigestSha256: "d".repeat(64) }),
      (bundle) => ({ ...bundle, policyId: "wrong" }),
      (bundle) => ({ ...bundle, artifactDigestSha256: "d".repeat(64) }),
      (bundle) => ({ ...bundle, frames: [] }),
      (bundle) => ({ ...bundle, frames: [{ ...bundle.frames[0], width: 2048 }] }),
      (bundle) => ({ ...bundle, totalByteLength: 8_388_609 }),
    ];
    for (const mutate of cases) {
      const harness = await makeHarness();
      const { ready } = await reachCaptureReady(harness);
      const bundle = await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url);
      await expectCode(harness.gateway.submitCapture({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "capture", nonceBase64Url: ready.session.nonceBase64Url, frameBundle: mutate(bundle) }, CONTEXT), "artifact_invalid");
    }
  });

  test("rejects oversized bodies before inspecting nested fields", async () => {
    const harness = await makeHarness({ maxRequestBodyBytes: 128 });
    const sentinel = new Proxy({}, { ownKeys() { throw new Error("nested body inspected"); } });
    await expectCode(harness.gateway.createSession({ ...createBody(), padding: "x".repeat(1000) }, CONTEXT), "body_too_large");
    await expectCode(harness.gateway.createSession(sentinel, CONTEXT), "body_too_large");
  });

  test("accepts only an allowlisted named synthetic fixture under synthetic policy", async () => {
    const harness = await makeHarness({
      capturePolicy: {
        version: SIMULATION_CAPTURE_POLICY_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        policyId: "policy-v0",
        dataMode: "synthetic_fixture",
        encoding: "rgba8",
        minFrames: 1,
        maxFrames: 2,
        maxWidth: 1024,
        maxHeight: 1024,
        maxFrameBytes: 4_194_304,
        maxTotalBytes: 8_388_608,
        captureOffsetsAreDiagnosticOnly: true,
        arrayOrderHasBiometricMeaning: false,
        qualityPolicyId: "quality-v0",
      },
    });
    const { ready } = await reachCaptureReady(harness);
    const frameBundle = await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url, "synthetic_fixture");
    const result = await harness.gateway.submitCapture({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "capture", nonceBase64Url: ready.session.nonceBase64Url, frameBundle }, CONTEXT);
    expect(result.session.state).toBe("simulated_credential_ready");
  });

  test("consumes each nonce once while returning the same authoritative idempotent status", async () => {
    const harness = await makeHarness();
    const { ready } = await reachCaptureReady(harness);
    const bundle = await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url);
    const request = { sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "capture", nonceBase64Url: ready.session.nonceBase64Url, frameBundle: bundle };
    const first = await harness.gateway.submitCapture(request, CONTEXT);
    const replay = await harness.gateway.submitCapture(request, CONTEXT);
    expect(replay.session).toEqual(first.session);
    expect(replay.code).toBe("simulated_credential_ready");
    expect(replay).toBe(first);
    expect(replay.credential).toEqual(first.credential);
    expect(replay.credential?.authentication.signatureBase64Url).toBe(
      first.credential?.authentication.signatureBase64Url,
    );
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen(replay.credential)).toBe(true);
    expect(Object.isFrozen(replay.credential?.claims)).toBe(true);
    expect(Object.isFrozen(replay.credential?.authentication)).toBe(true);
    expect(harness.calls.biometric).toBe(1);
    await expectCode(harness.gateway.submitCapture({ ...request, idempotencyKey: "different" }, CONTEXT), "replay_rejected");
    await expectCode(harness.gateway.submitCapture({ ...request, frameBundle: { ...bundle, artifactDigestSha256: "d".repeat(64) } }, CONTEXT), "binding_mismatch");
  });

  test("singleflights identical capture and rejects a concurrent key or artifact mismatch", async () => {
    const harness = await makeHarness();
    let announceStarted: (() => void) | undefined;
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    harness.biometricBarrier = { started: () => announceStarted?.(), release: held };
    const { ready } = await reachCaptureReady(harness);
    const frameBundle = await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url);
    const request = { sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "capture", nonceBase64Url: ready.session.nonceBase64Url, frameBundle };
    const first = harness.gateway.submitCapture(request, CONTEXT);
    await started;
    const duplicate = harness.gateway.submitCapture(request, CONTEXT);
    await expectCode(harness.gateway.submitCapture({ ...request, idempotencyKey: "capture-other" }, CONTEXT), "binding_mismatch");
    await expectCode(harness.gateway.submitCapture({ ...request, frameBundle: { ...frameBundle, artifactDigestSha256: "d".repeat(64) } }, CONTEXT), "binding_mismatch");
    await expectCode(harness.gateway.cancel({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle }, CONTEXT), "binding_mismatch");
    expect(harness.calls.biometric).toBe(1);
    release?.();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(duplicateResult).toBe(firstResult);
    expect(firstResult.credential).toBeDefined();
    expect(harness.calls.biometric).toBe(1);
    expect(harness.calls.issuance).toBe(1);
  });
});

describe("simulator failure safety and issuance gate", () => {
  test.each([
    ["spoof_reject", "simulated_reject", "simulation_reject", false],
    ["capture_retry", "simulated_retry", "simulation_retry", false],
    ["dependency_unavailable", "simulated_unavailable", "simulation_unavailable", false],
  ] as const)("maps %s deterministically without entering issuance", async (scenario, state, code, expectedIssuance) => {
    const harness = await makeHarness({}, { biometric: scenario, issuance: "issue_success" });
    const { ready } = await reachCaptureReady(harness);
    const result = await submitReady(harness, ready);
    expect(result.session.state).toBe(state);
    expect(result.code).toBe(code);
    expect(harness.calls.issuance > 0).toBe(expectedIssuance);
  });

  test.each(["throw", "malformed", "tampered", "port_error"] as const)("fails closed on %s biometric response", async (mode) => {
    const harness = await makeHarness();
    harness.biometricMode = mode;
    const { ready } = await reachCaptureReady(harness);
    const result = await submitReady(harness, ready);
    expect(result.session.state).toBe("simulated_unavailable");
    expect(result.code).toBe("simulation_unavailable");
    expect(harness.calls.issuance).toBe(0);
  });

  test.each(["throw", "malformed", "tampered", "wrong_outcome", "port_error"] as const)("fails closed on %s issuance response", async (mode) => {
    const harness = await makeHarness();
    harness.issuanceMode = mode;
    const { ready } = await reachCaptureReady(harness);
    const result = await submitReady(harness, ready);
    expect(result.session.state).toBe("simulated_issuance_unavailable");
    expect(result.code).toBe("issuance_unavailable");
    expect(result.credential).toBeUndefined();
  });

  test.each([
    ["issue_reject", "simulated_issuance_reject", "issuance_rejected", false],
    ["issue_unavailable", "simulated_issuance_unavailable", "issuance_unavailable", true],
  ] as const)("maps %s to its distinct V2 issuance state", async (scenario, state, code, retryable) => {
    const harness = await makeHarness({}, { biometric: "happy_path", issuance: scenario });
    const { ready } = await reachCaptureReady(harness);
    const result = await submitReady(harness, ready);
    expect(result.session.state).toBe(state);
    expect(result.code).toBe(code);
    expect(result.retryable).toBe(retryable);
  });

  test("retries an unavailable call with stable downstream idempotency and authoritative status", async () => {
    const harness = await makeHarness();
    harness.biometricMode = "throw";
    const { ready } = await reachCaptureReady(harness);
    const first = await submitReady(harness, ready);
    expect(first.retryable).toBe(true);
    harness.biometricMode = "normal";
    const retry = await harness.gateway.retryUnavailable({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "retry-1" }, CONTEXT);
    expect(retry.session.state).toBe("simulated_credential_ready");
    expect(harness.calls.biometricRequests[0]?.idempotencyKey).toBe(harness.calls.biometricRequests[1]?.idempotencyKey);
  });

  test("retries issuance unavailability without retaining a receipt or changing issuance idempotency", async () => {
    const harness = await makeHarness();
    harness.issuanceMode = "throw";
    const { ready } = await reachCaptureReady(harness);
    const first = await submitReady(harness, ready);
    expect(first.session.state).toBe("simulated_issuance_unavailable");
    harness.issuanceMode = "normal";
    const retry = await harness.gateway.retryUnavailable({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "issue-retry" }, CONTEXT);
    expect(retry.session.state).toBe("simulated_credential_ready");
    expect(harness.calls.issuanceRequests[0]?.idempotencyKey).toBe(harness.calls.issuanceRequests[1]?.idempotencyKey);
    expect(harness.calls.biometric).toBe(2);
  });

  test("singleflights unavailable retry and rejects a concurrent retry key", async () => {
    const harness = await makeHarness();
    harness.biometricMode = "throw";
    const { ready } = await reachCaptureReady(harness);
    await submitReady(harness, ready);

    harness.biometricMode = "normal";
    let announceStarted: (() => void) | undefined;
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    harness.biometricBarrier = { started: () => announceStarted?.(), release: held };
    const retryRequest = { sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "retry" };
    const first = harness.gateway.retryUnavailable(retryRequest, CONTEXT);
    await started;
    const duplicate = harness.gateway.retryUnavailable(retryRequest, CONTEXT);
    await expectCode(harness.gateway.retryUnavailable({ ...retryRequest, idempotencyKey: "retry-other" }, CONTEXT), "binding_mismatch");
    await expectCode(harness.gateway.cancel({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle }, CONTEXT), "binding_mismatch");
    expect(harness.calls.biometric).toBe(2);
    release?.();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(duplicateResult).toBe(firstResult);
    expect(firstResult.session.state).toBe("simulated_credential_ready");
    expect(harness.calls.biometric).toBe(2);
    expect(harness.calls.issuance).toBe(1);
  });

  test("bounds simulator time and global operation concurrency", async () => {
    let announceStarted: (() => void) | undefined;
    let releaseCall: ((value: unknown) => void) | undefined;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const held = new Promise<unknown>((resolve) => { releaseCall = resolve; });
    const harness = await makeHarness({
      maxConcurrentOperations: 1,
      simulatorTimeoutMs: 1_000,
      biometricClient: {
        readiness() { return { ready: true }; },
        async verify() { announceStarted?.(); return await held as never; },
      },
    });
    const first = await reachCaptureReady(harness);
    const secondCreated = await harness.gateway.createSession(createBody("create-two"), CONTEXT);
    await harness.gateway.completePasskey({ sessionId: secondCreated.session.sessionId, browserHandle: secondCreated.browserHandle, idempotencyKey: "passkey-two", ceremony: "valid-ceremony" }, CONTEXT);
    const second = await harness.gateway.prepareCapture({ sessionId: secondCreated.session.sessionId, browserHandle: secondCreated.browserHandle }, CONTEXT);
    const firstBundle = await makeBundle(first.ready.session.sessionId, first.ready.session.nonceBase64Url);
    const firstOperation = harness.gateway.submitCapture({ sessionId: first.ready.session.sessionId, browserHandle: first.ready.browserHandle, idempotencyKey: "capture-one", nonceBase64Url: first.ready.session.nonceBase64Url, frameBundle: firstBundle }, CONTEXT);
    await started;
    const secondBundle = await makeBundle(second.session.sessionId, second.session.nonceBase64Url);
    await expectCode(harness.gateway.submitCapture({ sessionId: second.session.sessionId, browserHandle: second.browserHandle, idempotencyKey: "capture-two", nonceBase64Url: second.session.nonceBase64Url, frameBundle: secondBundle }, CONTEXT), "resource_busy");
    releaseCall?.({});
    expect((await firstOperation).code).toBe("simulation_unavailable");

    const timeoutHarness = await makeHarness({
      simulatorTimeoutMs: 5,
      biometricClient: { readiness() { return { ready: true }; }, async verify() { return new Promise(() => undefined); } },
    });
    const timeoutReady = await reachCaptureReady(timeoutHarness);
    expect((await submitReady(timeoutHarness, timeoutReady.ready)).code).toBe("simulation_unavailable");
  });

  test("expires an in-flight session instead of converting timeout into retryable success", async () => {
    const clock = new MutableClock();
    const harness = await makeHarness({
      clock,
      biometricClient: {
        readiness() { return { ready: true }; },
        async verify() { clock.advance(60_000); throw new Error("late response"); },
      },
    });
    const { ready } = await reachCaptureReady(harness);
    const result = await submitReady(harness, ready);
    expect(result.session.state).toBe("expired");
    expect(result.code).toBe("expired");
    expect(result.retryable).toBe(false);
  });

  test("exposes readiness and immediate kill-switch behavior", async () => {
    const enabled = await makeHarness();
    expect(await enabled.gateway.readiness()).toEqual({ ready: true, code: "ready" });
    const disabled = await makeHarness({ enabled: false });
    expect(await disabled.gateway.readiness()).toEqual({ ready: false, code: "disabled" });
    await expectCode(disabled.gateway.createSession(createBody(), CONTEXT), "gateway_disabled");
  });

  test("readiness rejects reused public-key material regardless of key ID", async () => {
    const baseline = await makeHarness();
    const requestRoot = baseline.config.biometricRequestSigner.trustRoot;
    const sameId = await makeHarness({
      biometricRequestSigner: baseline.config.biometricRequestSigner,
      biometricReceiptTrustRoot: requestRoot,
    });
    expect(await sameId.gateway.readiness()).toEqual({
      ready: false,
      code: "dependency_unavailable",
    });
    const differentId = await makeHarness({
      biometricRequestSigner: baseline.config.biometricRequestSigner,
      biometricReceiptTrustRoot: { ...requestRoot, keyId: "different-purpose-id" },
    });
    expect(await differentId.gateway.readiness()).toEqual({
      ready: false,
      code: "dependency_unavailable",
    });
  });
});

describe("storage and redaction", () => {
  test("audit records contain only allowlisted transaction fields", async () => {
    const harness = await makeHarness();
    const { ready } = await reachCaptureReady(harness);
    await submitReady(harness, ready);
    for (const event of harness.events) {
      expect(Object.keys(event).every((key) => ["event", "sessionId", "state", "code"].includes(key))).toBe(true);
    }
    const serialized = JSON.stringify(harness.events);
    expect(serialized).not.toContain("signatureBase64Url");
    expect(serialized).not.toContain("credential-");
    expect(serialized).not.toContain("frameDigestSha256");
    expect(serialized).not.toContain("valid-ceremony");
  });

  test("purges expired records by TTL", async () => {
    const harness = await makeHarness();
    await harness.gateway.createSession(createBody(), CONTEXT);
    harness.clock.advance(60_000);
    expect(harness.gateway.purgeExpired()).toBe(1);
    expect(harness.gateway.purgeExpired()).toBe(0);
  });

  test("persisted records omit handles, ceremonies, signatures, and credential bodies", async () => {
    const records: unknown[] = [];
    const byId = new Map<string, any>();
    const repository = {
      get(sessionId: string) { return byId.get(sessionId); },
      put(record: any) { byId.set(record.session.sessionId, record); records.push(record); },
      findByCreationIdempotency() { return undefined; },
      purgeExpired() { return 0; },
    };
    const harness = await makeHarness({}, { biometric: "happy_path", issuance: "issue_success" }, repository);
    const { ready } = await reachCaptureReady(harness);
    await submitReady(harness, ready);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(ready.browserHandle);
    expect(serialized).not.toContain("valid-ceremony");
    expect(serialized).not.toContain("signatureBase64Url");
    expect(serialized).not.toContain("credential-");
    expect(serialized).not.toContain("authentication");
    expect(serialized).toContain("biometricRequestedAt");
    expect(serialized).toContain("issuanceRequestedAt");
  });

  test("contract validator independently rejects media and unknown descriptor fields", async () => {
    const harness = await makeHarness();
    const { ready } = await reachCaptureReady(harness);
    const bundle = await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url);
    expect(await validateFrameBundleV0({ ...bundle, mediaUrl: "https://example.test/face" }, ready.capturePolicy)).toContain("unknown.mediaUrl");
    expect(await validateFrameBundleV0({ ...bundle, frames: [{ ...bundle.frames[0], bytesBase64: "AAAA" }] }, ready.capturePolicy)).toContain("frames[0].unknown.bytesBase64");
  });
});
