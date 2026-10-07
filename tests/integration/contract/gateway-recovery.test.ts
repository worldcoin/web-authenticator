import { describe, expect, test } from "bun:test";
import {
  CONTEXT,
  createBody,
  makeBundle,
  makeHarness,
  reachCaptureReady,
} from "../../../services/session-gateway/test/helpers";

describe("session expiry, idempotency, malformed dependencies, and recovery", () => {
  test("replays exact creation idempotently and rejects a changed binding", async () => {
    const harness = await makeHarness();
    const first = await harness.gateway.createSession(createBody("create-idempotent"), CONTEXT);
    const replay = await harness.gateway.createSession(createBody("create-idempotent"), CONTEXT);
    expect(replay).toEqual(first);
    await expect(harness.gateway.createSession({
      ...createBody("create-idempotent"),
      accountId: "different-account",
    }, CONTEXT)).rejects.toMatchObject({ code: "binding_mismatch" });
  });

  test("expires a session against the server clock", async () => {
    const harness = await makeHarness();
    const created = await harness.gateway.createSession(createBody("expiry"), CONTEXT);
    harness.clock.advance(harness.config.sessionTtlMs + 1);
    await expect(harness.gateway.getStatus({
      sessionId: created.session.sessionId,
      browserHandle: created.browserHandle,
    }, CONTEXT)).rejects.toMatchObject({ code: "expired" });
  });

  test.each(["malformed", "tampered", "port_error"] as const)(
    "fails closed on %s biometric output and never enters issuance",
    async (mode) => {
      const harness = await makeHarness();
      harness.biometricMode = mode;
      const { ready } = await reachCaptureReady(harness);
      const result = await harness.gateway.submitCapture({
        sessionId: ready.session.sessionId,
        browserHandle: ready.browserHandle,
        idempotencyKey: `biometric-${mode}`,
        nonceBase64Url: ready.session.nonceBase64Url,
        frameBundle: await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url),
      }, CONTEXT);
      expect(result.session.state).toBe("simulated_unavailable");
      expect(harness.calls.issuance).toBe(0);
    },
  );

  test.each(["malformed", "tampered", "wrong_outcome", "port_error"] as const)(
    "fails closed on %s issuance output without a credential",
    async (mode) => {
      const harness = await makeHarness();
      harness.issuanceMode = mode;
      const { ready } = await reachCaptureReady(harness);
      const result = await harness.gateway.submitCapture({
        sessionId: ready.session.sessionId,
        browserHandle: ready.browserHandle,
        idempotencyKey: `issuance-${mode}`,
        nonceBase64Url: ready.session.nonceBase64Url,
        frameBundle: await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url),
      }, CONTEXT);
      expect(result.session.state).toBe("simulated_issuance_unavailable");
      expect(result.credential).toBeUndefined();
    },
  );

  test("recovers through retry after a lost biometric response without resubmitting browser media", async () => {
    const harness = await makeHarness();
    harness.biometricMode = "throw";
    const { ready } = await reachCaptureReady(harness);
    const first = await harness.gateway.submitCapture({
      sessionId: ready.session.sessionId,
      browserHandle: ready.browserHandle,
      idempotencyKey: "lost-biometric-response",
      nonceBase64Url: ready.session.nonceBase64Url,
      frameBundle: await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url),
    }, CONTEXT);
    expect(first.session.state).toBe("simulated_unavailable");
    harness.biometricMode = "normal";
    const recovered = await harness.gateway.retryUnavailable({
      sessionId: first.session.sessionId,
      browserHandle: ready.browserHandle,
      idempotencyKey: "recover-biometric-response",
    }, CONTEXT);
    expect(recovered.session.state).toBe("simulated_credential_ready");
    expect(harness.calls.biometric).toBe(2);
    expect(harness.calls.issuance).toBe(1);
  });
});
