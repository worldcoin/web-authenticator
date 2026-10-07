import { describe, expect, test } from "bun:test";
import {
  verifySimulationReceiptV0,
  type ExpectedSimulationReceiptV0,
  type SimulationReceiptV0,
} from "@clean-start/contracts";
import {
  CONTEXT,
  makeBundle,
  makeHarness,
  reachCaptureReady,
} from "../../../services/session-gateway/test/helpers";

async function captureReceipt() {
  const harness = await makeHarness();
  const { ready } = await reachCaptureReady(harness);
  const result = await harness.gateway.submitCapture({
    sessionId: ready.session.sessionId,
    browserHandle: ready.browserHandle,
    idempotencyKey: "nested-receipt-capture",
    nonceBase64Url: ready.session.nonceBase64Url,
    frameBundle: await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url),
  }, CONTEXT);
  expect(result.session.state).toBe("simulated_credential_ready");
  const receipt = harness.calls.issuanceRequests.at(0)?.biometricReceipt;
  if (receipt === undefined) throw new Error("receipt_not_observed");
  const expected: ExpectedSimulationReceiptV0 = {
    runtimeEnvironment: "staging",
    receiptId: receipt.receiptId,
    requestId: receipt.requestId,
    sessionId: receipt.sessionId,
    nonceDigestSha256: receipt.nonceDigestSha256,
    idempotencyKey: receipt.idempotencyKey,
    accountPublicMaterialDigestSha256: receipt.accountPublicMaterialDigestSha256,
    capturePolicyId: receipt.capturePolicyId,
    scenario: receipt.scenario,
    artifactDigestSha256: receipt.artifactDigestSha256,
    now: harness.clock.now().toISOString(),
  };
  return { harness, receipt, expected };
}

describe("nested biometric receipt authentication", () => {
  test("accepts the exact nested receipt and rejects key, audience, expiry, and binding changes", async () => {
    const { harness, receipt, expected } = await captureReceipt();
    expect(await verifySimulationReceiptV0(
      receipt,
      expected,
      harness.config.biometricReceiptTrustRoot,
    )).toBe(true);

    const cases: readonly SimulationReceiptV0[] = [
      {
        ...receipt,
        authentication: { ...receipt.authentication, keyId: "wrong-key" },
      },
      { ...receipt, audience: "wrong-audience" as SimulationReceiptV0["audience"] },
      { ...receipt, sessionId: "wrong-session" },
      { ...receipt, nonceDigestSha256: "f".repeat(64) },
      { ...receipt, artifactDigestSha256: "e".repeat(64) },
    ];
    for (const candidate of cases) {
      expect(await verifySimulationReceiptV0(
        candidate,
        expected,
        harness.config.biometricReceiptTrustRoot,
      )).toBe(false);
    }

    harness.clock.advance(Date.parse(receipt.expiresAt) - harness.clock.now().getTime() + 1);
    expect(await verifySimulationReceiptV0(
      receipt,
      { ...expected, now: harness.clock.now().toISOString() },
      harness.config.biometricReceiptTrustRoot,
    )).toBe(false);
  });

  test("does not invoke issuance when the nested receipt binding is tampered", async () => {
    const harness = await makeHarness();
    harness.biometricMode = "tampered";
    const { ready } = await reachCaptureReady(harness);
    const result = await harness.gateway.submitCapture({
      sessionId: ready.session.sessionId,
      browserHandle: ready.browserHandle,
      idempotencyKey: "tampered-nested-receipt",
      nonceBase64Url: ready.session.nonceBase64Url,
      frameBundle: await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url),
    }, CONTEXT);
    expect(result.session.state).toBe("simulated_unavailable");
    expect(harness.calls.issuance).toBe(0);
  });
});
