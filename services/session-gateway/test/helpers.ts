import {
  BIOMETRIC_SCENARIO_OUTCOME_V0,
  BIOMETRIC_SCENARIO_REASON_V0,
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  BIOMETRIC_VERIFICATION_PORT_V0,
  bytesToArrayBuffer,
  bytesToBase64Url,
  computeFrameBundleDigestV0,
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  SIMULATED_STAGING_AUDIENCE_V0,
  SIMULATED_STAGING_CREDENTIAL_V0,
  SIMULATED_STAGING_ISSUER_V0,
  SIMULATION_CAPTURE_POLICY_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATION_RECEIPT_V0,
  stagingSignaturePreimageV0,
  STAGING_ISSUANCE_PORT_V0,
  type BiometricSimulationRequestV0,
  type FrameBundleV0,
  type HexSha256,
  type SimulatedStagingCredentialV0,
  type SimulationReceiptV0,
  type StagingAuthenticationV0,
  type StagingEd25519TrustRootV0,
  type StagingIssuanceSimulationRequestV0,
} from "../../../packages/contracts/src";
import {
  BIOMETRIC_SIMULATION_ERROR_V0,
  SIMULATION_RECEIPT_READY_V0,
  type BiometricVerificationInvocationV0,
  type BiometricVerificationResultV0,
} from "../../../packages/biometric-verification-port/src";
import {
  STAGING_ISSUANCE_ERROR_V0,
  type StagingIssuanceInvocationV0,
  type StagingIssuancePortResultV0,
} from "../../../packages/staging-issuance-port/src";
import {
  SessionGatewayV0,
  sha256Text,
  type GatewayAuditEventV0,
  type GatewayRequestSignerV0,
  type SessionGatewayConfigV0,
  type SessionRepositoryV0,
} from "../src";

export const ACCOUNT_DIGEST = "a".repeat(64) as HexSha256;
export const RP_DIGEST = "b".repeat(64) as HexSha256;
export const FRAME_DIGEST = "c".repeat(64) as HexSha256;
export const CONTEXT = Object.freeze({
  origin: "https://auth.example.test",
  rpId: "auth.example.test",
  authenticatedServerContext: "server-authenticated",
});

export class MutableClock {
  constructor(private timestamp = Date.parse("2026-09-02T18:00:00.000Z")) {}
  now(): Date { return new Date(this.timestamp); }
  advance(milliseconds: number): void { this.timestamp += milliseconds; }
}

export interface TestSigner extends GatewayRequestSignerV0 {
  readonly privateKey: CryptoKey;
}

export async function createSigner(audience: string, keyId: string): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    privateKey: pair.privateKey,
    trustRoot: {
      environment: SIMULATION_ENVIRONMENT,
      audience,
      keyId,
      publicKeyRawBase64Url: bytesToBase64Url(publicKey),
    },
    async sign(preimage: Uint8Array): Promise<string> {
      const signature = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, bytesToArrayBuffer(preimage));
      return bytesToBase64Url(new Uint8Array(signature));
    },
  };
}

async function sign<T extends { authentication: StagingAuthenticationV0 }>(value: T, signer: TestSigner): Promise<T> {
  const unsigned = {
    ...value,
    authentication: {
      scheme: "staging-ed25519" as const,
      keyId: signer.trustRoot.keyId,
      signatureBase64Url: "pending",
    },
  };
  return {
    ...unsigned,
    authentication: {
      ...unsigned.authentication,
      signatureBase64Url: await signer.sign(stagingSignaturePreimageV0(unsigned as unknown as Record<string, unknown>)),
    },
  } as T;
}

export interface Harness {
  readonly gateway: SessionGatewayV0;
  readonly config: SessionGatewayConfigV0;
  readonly clock: MutableClock;
  readonly events: GatewayAuditEventV0[];
  readonly calls: {
    biometric: number;
    issuance: number;
    biometricRequests: BiometricSimulationRequestV0[];
    issuanceRequests: StagingIssuanceSimulationRequestV0[];
  };
  biometricMode: "normal" | "throw" | "malformed" | "tampered" | "port_error";
  issuanceMode: "normal" | "throw" | "malformed" | "tampered" | "wrong_outcome" | "port_error";
  biometricBarrier?: {
    readonly started: () => void;
    readonly release: Promise<void>;
  };
}

export async function makeHarness(overrides: Partial<SessionGatewayConfigV0> = {}, scenarios: { biometric: "happy_path" | "spoof_reject" | "capture_retry" | "dependency_unavailable"; issuance: "issue_success" | "issue_reject" | "issue_unavailable" } = { biometric: "happy_path", issuance: "issue_success" }, repository?: SessionRepositoryV0): Promise<Harness> {
  const clock = new MutableClock();
  const [gatewayBiometric, receiptSigner, gatewayIssuance, credentialSigner] = await Promise.all([
    createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "gateway-biometric"),
    createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "receipt-signer"),
    createSigner("world_id_web_authenticator_issuance_simulator_staging", "gateway-issuance"),
    createSigner(SIMULATED_STAGING_AUDIENCE_V0, "credential-signer"),
  ]);
  const handleKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  const events: GatewayAuditEventV0[] = [];
  const calls = { biometric: 0, issuance: 0, biometricRequests: [] as BiometricSimulationRequestV0[], issuanceRequests: [] as StagingIssuanceSimulationRequestV0[] };
  const harness = { biometricMode: "normal", issuanceMode: "normal" } as Harness;
  const config: SessionGatewayConfigV0 = {
    runtimeEnvironment: "staging",
    enabled: true,
    sessionTtlMs: 60_000,
    maxRequestBodyBytes: 16_384,
    maxConcurrentOperations: 2,
    simulatorTimeoutMs: 1_000,
    capturePolicy: {
      version: SIMULATION_CAPTURE_POLICY_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      policyId: "policy-v0",
      dataMode: "metadata_only",
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
    allowedSyntheticFixtureIds: ["fixture-neutral-v0"],
    handleKey,
    rpRequestVerifier: {
      async verify(request, context) {
        if (request !== "signed-rp-request" || context.origin !== CONTEXT.origin || context.rpId !== CONTEXT.rpId) return null;
        return { rpId: CONTEXT.rpId, origin: CONTEXT.origin, returnTarget: "https://rp.example.test/return", requestDigestSha256: RP_DIGEST };
      },
    },
    ceremonyVerifier: { async verify(ceremony) { return ceremony === "valid-ceremony"; } },
    scenarioSelector: {
      async select(input) {
        if (input.authenticatedServerContext !== "server-authenticated") throw new Error("unauthenticated selector context");
        return scenarios;
      },
    },
    biometricRequestSigner: gatewayBiometric,
    issuanceRequestSigner: gatewayIssuance,
    biometricReceiptTrustRoot: receiptSigner.trustRoot,
    simulatedCredentialTrustRoot: credentialSigner.trustRoot,
    biometricClient: {
      readiness() { return { ready: true }; },
      async verify(invocation: BiometricVerificationInvocationV0): Promise<BiometricVerificationResultV0> {
        const request = invocation.request as BiometricSimulationRequestV0;
        calls.biometric += 1;
        calls.biometricRequests.push(request);
        harness.biometricBarrier?.started();
        if (harness.biometricBarrier !== undefined) {
          await harness.biometricBarrier.release;
        }
        if (harness.biometricMode === "throw") throw new Error("untrusted upstream details");
        if (harness.biometricMode === "port_error") {
          return { kind: BIOMETRIC_SIMULATION_ERROR_V0, reasonCode: "service_not_ready" };
        }
        if (harness.biometricMode === "malformed") {
          return { outcome: "simulated_pass" } as unknown as BiometricVerificationResultV0;
        }
        const receipt: SimulationReceiptV0 = await sign({
          kind: SIMULATION_RECEIPT_V0,
          version: BIOMETRIC_VERIFICATION_PORT_V0,
          mode: SIMULATION_MODE,
          environment: SIMULATION_ENVIRONMENT,
          audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
          receiptId: `receipt-${request.requestId}`,
          requestId: request.requestId,
          simulatorVersion: "test-simulator-v0",
          scenario: request.scenario,
          sessionId: request.sessionId,
          nonceDigestSha256: request.nonceDigestSha256,
          idempotencyKey: request.idempotencyKey,
          accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
          capturePolicyId: request.capturePolicyId,
          artifactDigestSha256: request.frameBundle.artifactDigestSha256,
          outcome: BIOMETRIC_SCENARIO_OUTCOME_V0[request.scenario],
          reasonCode: BIOMETRIC_SCENARIO_REASON_V0[request.scenario],
          issuedAt: clock.now().toISOString(),
          expiresAt: request.expiresAt,
          authentication: { scheme: "staging-ed25519", keyId: "pending", signatureBase64Url: "pending" },
        }, receiptSigner);
        return {
          kind: SIMULATION_RECEIPT_READY_V0,
          receipt: harness.biometricMode === "tampered"
            ? { ...receipt, sessionId: "tampered" }
            : receipt,
        } as BiometricVerificationResultV0;
      },
    },
    issuanceClient: {
      readiness() { return { ready: true }; },
      async issue(invocation: StagingIssuanceInvocationV0): Promise<StagingIssuancePortResultV0> {
        const request = invocation.request as StagingIssuanceSimulationRequestV0;
        calls.issuance += 1;
        calls.issuanceRequests.push(request);
        if (harness.issuanceMode === "throw") throw new Error("untrusted issuer details");
        if (harness.issuanceMode === "port_error") {
          return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "service_not_ready" };
        }
        if (harness.issuanceMode === "malformed") {
          return { kind: "simulated_credential_ready_v0", credential: { claims: {} } } as unknown as StagingIssuancePortResultV0;
        }
        if (harness.issuanceMode === "wrong_outcome") return { kind: "simulated_issuance_rejected_v0", reasonCode: "scenario_issue_reject" };
        if (request.scenario === "issue_reject") return { kind: "simulated_issuance_rejected_v0", reasonCode: "scenario_issue_reject" };
        if (request.scenario === "issue_unavailable") return { kind: "simulated_issuance_unavailable_v0", reasonCode: "scenario_issue_unavailable" };
        const credential: SimulatedStagingCredentialV0 = await sign({
          kind: SIMULATED_STAGING_CREDENTIAL_V0,
          version: STAGING_ISSUANCE_PORT_V0,
          mode: SIMULATION_MODE,
          environment: SIMULATION_ENVIRONMENT,
          credentialId: `credential-${request.requestId}`,
          issuer: SIMULATED_STAGING_ISSUER_V0,
          audience: SIMULATED_STAGING_AUDIENCE_V0,
          issuanceRequestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          nonceDigestSha256: request.nonceDigestSha256,
          subjectAccountId: request.accountId,
          accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
          simulationReceiptId: request.biometricReceipt.receiptId,
          claims: { biometricVerification: "simulated_not_performed", uniqueness: "not_performed", credentialClass: "not_selfie_check" },
          issuedAt: clock.now().toISOString(),
          expiresAt: request.expiresAt,
          authentication: { scheme: "staging-ed25519", keyId: "pending", signatureBase64Url: "pending" },
        }, credentialSigner);
        return {
          kind: "simulated_credential_ready_v0",
          credential: harness.issuanceMode === "tampered"
            ? { ...credential, subjectAccountId: "tampered" }
            : credential,
        } as StagingIssuancePortResultV0;
      },
    },
    auditSink: { record(event) { events.push(event); } },
    clock,
    ...overrides,
  };
  Object.assign(harness, {
    gateway: new SessionGatewayV0(config, repository),
    config,
    clock,
    events,
    calls,
  });
  return harness;
}

export function createBody(idempotencyKey = "create-key") {
  return { rpRequest: "signed-rp-request", accountId: "account-v0", accountPublicMaterialDigestSha256: ACCOUNT_DIGEST, idempotencyKey };
}

export async function reachCaptureReady(harness: Harness) {
  const created = await harness.gateway.createSession(createBody(), CONTEXT);
  await harness.gateway.completePasskey({ sessionId: created.session.sessionId, browserHandle: created.browserHandle, idempotencyKey: "passkey-key", ceremony: "valid-ceremony" }, CONTEXT);
  const ready = await harness.gateway.prepareCapture({ sessionId: created.session.sessionId, browserHandle: created.browserHandle }, CONTEXT);
  return { created, ready };
}

export async function makeBundle(sessionId: string, nonce: string, dataMode: "metadata_only" | "synthetic_fixture" = "metadata_only"): Promise<FrameBundleV0> {
  const pending: FrameBundleV0 = {
    kind: FRAME_BUNDLE_V0,
    mode: SIMULATION_MODE,
    sessionId,
    policyId: "policy-v0",
    accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
    nonceDigestSha256: await sha256Text(nonce),
    dataMode,
    frames: [{ transportIndex: 0, width: 640, height: 480, encoding: "rgba8", byteLength: 1_228_800, frameDigestSha256: FRAME_DIGEST, captureOffsetMs: 0 }],
    ...(dataMode === "synthetic_fixture" ? { syntheticFixtureId: "fixture-neutral-v0" } : {}),
    totalByteLength: 1_228_800,
    digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
    artifactDigestSha256: "0".repeat(64),
  };
  return { ...pending, artifactDigestSha256: await computeFrameBundleDigestV0(pending) };
}

export async function submitReady(harness: Harness, ready: Awaited<ReturnType<typeof reachCaptureReady>>["ready"], idempotencyKey = "capture-key") {
  return harness.gateway.submitCapture({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey, nonceBase64Url: ready.session.nonceBase64Url, frameBundle: await makeBundle(ready.session.sessionId, ready.session.nonceBase64Url) }, CONTEXT);
}
