import { describe, expect, test } from "bun:test";
import {
  BIOMETRIC_SCENARIO_OUTCOME_V0,
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  SIMULATED_STAGING_AUDIENCE_V0,
  SIMULATION_ENVIRONMENT,
  STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
  verifySimulatedStagingCredentialV0,
  type BiometricSimulationScenarioV0,
  type IssuanceSimulationScenarioV0,
} from "../../../packages/contracts/src";
import {
  SIMULATION_RECEIPT_READY_V0,
  type BiometricVerificationResultV0,
  type BiometricVerificationPortV0,
} from "../../../packages/biometric-verification-port/src";
import type { StagingIssuancePortV0 } from "../../../packages/staging-issuance-port/src";
import type { StagingIssuancePortResultV0 } from "../../../packages/staging-issuance-port/src";
import { SimulatedBiometricVerifierV0 } from "../../simulated-biometric-verifier/src";
import { SimulatedStagingIssuerV0 } from "../../simulated-staging-issuer/src";
import {
  ACCOUNT_DIGEST,
  CONTEXT,
  createSigner,
  makeBundle,
  makeHarness,
  MutableClock,
  reachCaptureReady,
} from "./helpers";

interface RealHarness {
  readonly harness: Awaited<ReturnType<typeof makeHarness>>;
  readonly biometric: SimulatedBiometricVerifierV0;
  readonly issuer: SimulatedStagingIssuerV0;
  readonly credentialTrustRoot: Awaited<ReturnType<typeof createSigner>>["trustRoot"];
  readonly clock: MutableClock;
  readonly issuerCalls: { count: number };
  readonly biometricResults: BiometricVerificationResultV0[];
  readonly issuanceResults: StagingIssuancePortResultV0[];
}

interface RealHarnessOptions {
  readonly tamperReceipt?: boolean;
  readonly dropReceiptOnce?: boolean;
  readonly dropCredentialOnce?: boolean;
}

async function makeRealHarness(
  biometricScenario: BiometricSimulationScenarioV0,
  issuanceScenario: IssuanceSimulationScenarioV0,
  options: RealHarnessOptions = {},
): Promise<RealHarness> {
  const clock = new MutableClock();
  const [gatewayBiometric, receiptSigner, gatewayIssuance, credentialSigner] = await Promise.all([
    createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "integration-gateway-biometric"),
    createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "integration-receipt"),
    createSigner(STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0, "integration-gateway-issuance"),
    createSigner(SIMULATED_STAGING_AUDIENCE_V0, "integration-credential"),
  ]);
  const biometric = new SimulatedBiometricVerifierV0({
    runtimeEnvironment: "staging",
    gatewayTrustRoot: gatewayBiometric.trustRoot,
    receiptSigner: {
      environment: SIMULATION_ENVIRONMENT,
      audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
      keyId: receiptSigner.trustRoot.keyId,
      privateKey: receiptSigner.privateKey,
    },
    simulatorVersion: "gateway-integration-biometric-v0",
    receiptTtlMs: 30_000,
    maxCacheEntries: 100,
    allowedSyntheticFixtureIds: ["fixture-neutral-v0"],
    now: () => clock.now(),
  });
  const issuer = new SimulatedStagingIssuerV0({
    runtimeEnvironment: "staging",
    gatewayTrustRoot: gatewayIssuance.trustRoot,
    biometricReceiptTrustRoot: receiptSigner.trustRoot,
    credentialSigner: {
      environment: SIMULATION_ENVIRONMENT,
      audience: SIMULATED_STAGING_AUDIENCE_V0,
      keyId: credentialSigner.trustRoot.keyId,
      privateKey: credentialSigner.privateKey,
    },
    credentialTtlMs: 30_000,
    maxCacheEntries: 100,
    now: () => clock.now(),
  });
  const biometricResults: BiometricVerificationResultV0[] = [];
  const biometricPort: BiometricVerificationPortV0 = {
    readiness: () => biometric.readiness(),
    async verify(invocation) {
      const result = await biometric.verify(invocation);
      biometricResults.push(result);
      if (options.dropReceiptOnce && biometricResults.length === 1) {
        throw new Error("simulated_lost_receipt_response");
      }
      if (!options.tamperReceipt || result.kind !== SIMULATION_RECEIPT_READY_V0) {
        return result;
      }
      return {
        ...result,
        receipt: {
          ...result.receipt,
          authentication: {
            ...result.receipt.authentication,
            signatureBase64Url: `${result.receipt.authentication.signatureBase64Url}x`,
          },
        },
      };
    },
  };
  const issuerCalls = { count: 0 };
  const issuanceResults: StagingIssuancePortResultV0[] = [];
  const issuancePort: StagingIssuancePortV0 = {
    readiness: () => issuer.readiness(),
    async issue(invocation) {
      issuerCalls.count += 1;
      const result = await issuer.issue(invocation);
      issuanceResults.push(result);
      if (
        options.dropCredentialOnce &&
        issuanceResults.length === 1 &&
        result.kind === "simulated_credential_ready_v0"
      ) {
        throw new Error("simulated_lost_credential_response");
      }
      return result;
    },
  };
  const harness = await makeHarness({
    clock,
    biometricRequestSigner: gatewayBiometric,
    issuanceRequestSigner: gatewayIssuance,
    biometricReceiptTrustRoot: receiptSigner.trustRoot,
    simulatedCredentialTrustRoot: credentialSigner.trustRoot,
    biometricClient: biometricPort,
    issuanceClient: issuancePort,
  }, { biometric: biometricScenario, issuance: issuanceScenario });
  return {
    harness,
    biometric,
    issuer,
    credentialTrustRoot: credentialSigner.trustRoot,
    clock,
    issuerCalls,
    biometricResults,
    issuanceResults,
  };
}

async function submit(real: RealHarness, idempotencyKey = "real-capture") {
  const { ready } = await reachCaptureReady(real.harness);
  const frameBundle = await makeBundle(
    ready.session.sessionId,
    ready.session.nonceBase64Url,
  );
  const request = {
    sessionId: ready.session.sessionId,
    browserHandle: ready.browserHandle,
    idempotencyKey,
    nonceBase64Url: ready.session.nonceBase64Url,
    frameBundle,
  };
  return {
    request,
    result: await real.harness.gateway.submitCapture(request, CONTEXT),
  };
}

describe("gateway with real deterministic simulator ports", () => {
  for (const [scenario, state, code] of [
    ["happy_path", "simulated_credential_ready", "simulated_credential_ready"],
    ["spoof_reject", "simulated_reject", "simulation_reject"],
    ["capture_retry", "simulated_retry", "simulation_retry"],
    ["dependency_unavailable", "simulated_unavailable", "simulation_unavailable"],
  ] as const) {
    test(`runs biometric scenario ${scenario} through the typed W10 port`, async () => {
      const real = await makeRealHarness(scenario, "issue_success");
      const { result } = await submit(real);
      expect(result.session.biometricScenario).toBe(scenario);
      expect(result.session.state).toBe(state);
      expect(result.code).toBe(code);
      expect(real.issuerCalls.count).toBe(scenario === "happy_path" ? 1 : 0);
      if (scenario === "happy_path") expect(result.credential).toBeDefined();
      else expect(result.credential).toBeUndefined();
    });
  }

  for (const [scenario, state, code] of [
    ["issue_success", "simulated_credential_ready", "simulated_credential_ready"],
    ["issue_reject", "simulated_issuance_reject", "issuance_rejected"],
    ["issue_unavailable", "simulated_issuance_unavailable", "issuance_unavailable"],
  ] as const) {
    test(`runs issuance scenario ${scenario} through the typed W10 port`, async () => {
      const real = await makeRealHarness("happy_path", scenario);
      const { result } = await submit(real);
      expect(result.session.issuanceScenario).toBe(scenario);
      expect(result.session.state).toBe(state);
      expect(result.code).toBe(code);
      expect(real.issuerCalls.count).toBe(1);
    });
  }

  test("returns the exact signed credential on an idempotent lost-response retry", async () => {
    const real = await makeRealHarness("happy_path", "issue_success");
    const { request, result } = await submit(real);
    const retry = await real.harness.gateway.submitCapture(request, CONTEXT);
    expect(retry).toBe(result);
    expect(retry.credential).toBeDefined();
    expect(retry.credential?.claims).toEqual({
      biometricVerification: "simulated_not_performed",
      uniqueness: "not_performed",
      credentialClass: "not_selfie_check",
    });
    expect(await verifySimulatedStagingCredentialV0(retry.credential, {
      runtimeEnvironment: "staging",
      issuanceRequestId: retry.credential!.issuanceRequestId,
      idempotencyKey: retry.credential!.idempotencyKey,
      nonceDigestSha256: retry.credential!.nonceDigestSha256,
      subjectAccountId: "account-v0",
      accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
      simulationReceiptId: retry.credential!.simulationReceiptId,
      now: real.clock.now().toISOString(),
    }, real.credentialTrustRoot)).toBe(true);
    expect(real.issuerCalls.count).toBe(1);
  });

  test("rejects a tampered nested receipt before invoking the real issuer", async () => {
    const real = await makeRealHarness("happy_path", "issue_success", {
      tamperReceipt: true,
    });
    const { result } = await submit(real);
    expect(result.session.state).toBe("simulated_unavailable");
    expect(result.code).toBe("simulation_unavailable");
    expect(result.credential).toBeUndefined();
    expect(real.issuerCalls.count).toBe(0);
  });

  test("recovers the exact W10 receipt after processing, response loss, and clock advance", async () => {
    const real = await makeRealHarness("happy_path", "issue_success", {
      dropReceiptOnce: true,
    });
    const first = await submit(real);
    expect(first.result.session.state).toBe("simulated_unavailable");
    expect(real.biometricResults).toHaveLength(1);
    real.clock.advance(1_000);
    const recovered = await real.harness.gateway.retryUnavailable({
      sessionId: first.result.session.sessionId,
      browserHandle: first.request.browserHandle,
      idempotencyKey: "recover-receipt",
    }, CONTEXT);
    expect(recovered.session.state).toBe("simulated_credential_ready");
    expect(real.biometricResults).toHaveLength(2);
    expect(real.biometricResults[1]).toBe(real.biometricResults[0]);
    if (
      real.biometricResults[0]?.kind === SIMULATION_RECEIPT_READY_V0 &&
      real.biometricResults[1]?.kind === SIMULATION_RECEIPT_READY_V0
    ) {
      expect(real.biometricResults[1].receipt).toBe(real.biometricResults[0].receipt);
      expect(real.biometricResults[1].receipt.authentication.signatureBase64Url).toBe(
        real.biometricResults[0].receipt.authentication.signatureBase64Url,
      );
    }
  });

  test("recovers the exact W10 credential after processing, response loss, and clock advance", async () => {
    const real = await makeRealHarness("happy_path", "issue_success", {
      dropCredentialOnce: true,
    });
    const first = await submit(real);
    expect(first.result.session.state).toBe("simulated_issuance_unavailable");
    expect(real.issuanceResults).toHaveLength(1);
    real.clock.advance(1_000);
    const recovered = await real.harness.gateway.retryUnavailable({
      sessionId: first.result.session.sessionId,
      browserHandle: first.request.browserHandle,
      idempotencyKey: "recover-credential",
    }, CONTEXT);
    expect(recovered.session.state).toBe("simulated_credential_ready");
    expect(real.biometricResults[1]).toBe(real.biometricResults[0]);
    expect(real.issuanceResults).toHaveLength(2);
    expect(real.issuanceResults[1]).toBe(real.issuanceResults[0]);
    if (
      real.issuanceResults[0]?.kind === "simulated_credential_ready_v0" &&
      real.issuanceResults[1]?.kind === "simulated_credential_ready_v0"
    ) {
      expect(recovered.credential).toEqual(real.issuanceResults[0].credential);
      expect(real.issuanceResults[1].credential.authentication.signatureBase64Url).toBe(
        real.issuanceResults[0].credential.authentication.signatureBase64Url,
      );
    }
  });

  test("reports ready only when both real W10 ports are ready", async () => {
    const real = await makeRealHarness("happy_path", "issue_success");
    expect(real.biometric.readiness()).toEqual({ ready: true });
    expect(real.issuer.readiness()).toEqual({ ready: true });
    expect(await real.harness.gateway.readiness()).toEqual({ ready: true, code: "ready" });
    expect(BIOMETRIC_SCENARIO_OUTCOME_V0.happy_path).toBe("simulated_pass");
  });
});
