import { beforeAll, describe, expect, test } from "bun:test";
import {
  assertSimulationArtifactAllowed,
  BIOMETRIC_SCENARIO_OUTCOME_V0,
  BIOMETRIC_SIMULATION_REQUEST_V0,
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  BIOMETRIC_VERIFICATION_PORT_V0,
  bytesToBase64Url,
  bytesToArrayBuffer,
  CLIENT_QUALITY_POLICY_V0,
  computeFrameBundleDigestV0,
  ENROLLMENT_SESSION_V2,
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  isEnrollmentTransitionAllowedV2,
  isSimulatedStagingCredentialV0,
  isSimulationReceiptV0,
  PRF_INPUT_V1_SHA256,
  SIMULATED_STAGING_AUDIENCE_V0,
  SIMULATED_STAGING_CREDENTIAL_V0,
  SIMULATED_STAGING_ISSUER_V0,
  SIMULATION_CAPTURE_POLICY_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SimulationArtifactInProductionError,
  stagingSignaturePreimageV0,
  STAGING_ISSUANCE_PORT_V0,
  STAGING_ISSUANCE_SIMULATION_REQUEST_V0,
  STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
  validateClientQualityPolicyV0,
  validateFrameBundleV0,
  validateSimulationCapturePolicyV0,
  validateWorldIdRegistrationAdapterPolicyV1,
  verifyBiometricSimulationRequestV0,
  verifySimulatedStagingCredentialV0,
  verifySimulationReceiptV0,
  verifyStagingIssuanceSimulationRequestV0,
  WEB_AUTHN_PRF_AUTHENTICATOR_V1,
  WORLD_ID_REGISTRATION_ADAPTER_V1,
  type BiometricSimulationRequestV0,
  type ClientQualityPolicyV0,
  type EnrollmentSessionV2,
  type FrameBundleV0,
  type HexSha256,
  type SimulatedStagingCredentialV0,
  type SimulationCapturePolicyV0,
  type SimulationReceiptV0,
  type StagingAuthenticationV0,
  type StagingEd25519TrustRootV0,
  type StagingIssuanceSimulationRequestV0,
  type WebAuthnPrfAuthenticatorPolicyV1,
  type WorldIdRegistrationAdapterPolicyV1,
} from "../src";

const ZERO_HASH = "0".repeat(64) as HexSha256;
const ONE_HASH = "1".repeat(64) as HexSha256;
const NOW = "2026-09-02T18:30:00Z";

interface TestSigner {
  readonly privateKey: CryptoKey;
  readonly trustRoot: StagingEd25519TrustRootV0;
}

let gatewayBiometricSigner: TestSigner;
let biometricReceiptSigner: TestSigner;
let gatewayIssuanceSigner: TestSigner;
let issuanceCredentialSigner: TestSigner;

async function createSigner(audience: string, keyId: string): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    privateKey: pair.privateKey,
    trustRoot: {
      environment: SIMULATION_ENVIRONMENT,
      audience,
      keyId,
      publicKeyRawBase64Url: bytesToBase64Url(publicKey),
    },
  };
}

async function signArtifact<T extends { readonly authentication: StagingAuthenticationV0 }>(
  value: T,
  signer: TestSigner,
): Promise<T> {
  const unsigned = {
    ...value,
    authentication: {
      scheme: "staging-ed25519" as const,
      keyId: signer.trustRoot.keyId,
      signatureBase64Url: "pending",
    },
  };
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    signer.privateKey,
    bytesToArrayBuffer(
      stagingSignaturePreimageV0(unsigned as unknown as Record<string, unknown>),
    ),
  );
  return {
    ...unsigned,
    authentication: {
      ...unsigned.authentication,
      signatureBase64Url: bytesToBase64Url(new Uint8Array(signature)),
    },
  } as T;
}

beforeAll(async () => {
  [gatewayBiometricSigner, biometricReceiptSigner, gatewayIssuanceSigner, issuanceCredentialSigner] =
    await Promise.all([
      createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "gateway-biometric-key"),
      createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "biometric-receipt-key"),
      createSigner(STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0, "gateway-issuance-key"),
      createSigner(SIMULATED_STAGING_AUDIENCE_V0, "issuance-credential-key"),
    ]);
});

const capturePolicy: SimulationCapturePolicyV0 = {
  version: SIMULATION_CAPTURE_POLICY_V0,
  mode: SIMULATION_MODE,
  environment: SIMULATION_ENVIRONMENT,
  policyId: "capture-policy-fixture",
  dataMode: "metadata_only",
  encoding: "rgba8",
  minFrames: 1,
  maxFrames: 4,
  maxWidth: 4096,
  maxHeight: 4096,
  maxFrameBytes: 67_108_864,
  maxTotalBytes: 268_435_456,
  captureOffsetsAreDiagnosticOnly: true,
  arrayOrderHasBiometricMeaning: false,
  qualityPolicyId: "quality-policy-fixture",
  expiresAt: "2026-09-02T19:00:00Z",
};

async function makeFrameBundle(): Promise<FrameBundleV0> {
  const pending: FrameBundleV0 = {
    kind: FRAME_BUNDLE_V0,
    mode: SIMULATION_MODE,
    sessionId: "session-fixture",
    policyId: capturePolicy.policyId,
    accountPublicMaterialDigestSha256: ZERO_HASH,
    nonceDigestSha256: ONE_HASH,
    dataMode: "metadata_only",
    frames: [
      {
        transportIndex: 0,
        width: 640,
        height: 480,
        encoding: "rgba8",
        byteLength: 1_228_800,
        frameDigestSha256: ZERO_HASH,
        captureOffsetMs: 0,
      },
    ],
    totalByteLength: 1_228_800,
    digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
    artifactDigestSha256: ZERO_HASH,
  };
  return { ...pending, artifactDigestSha256: await computeFrameBundleDigestV0(pending) };
}

async function makeBiometricRequest(
  frameBundle: FrameBundleV0,
): Promise<BiometricSimulationRequestV0> {
  return signArtifact(
    {
      kind: BIOMETRIC_SIMULATION_REQUEST_V0,
      version: BIOMETRIC_VERIFICATION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
      requestId: "biometric-request-fixture",
      sessionId: frameBundle.sessionId,
      nonceDigestSha256: frameBundle.nonceDigestSha256,
      idempotencyKey: "biometric-idempotency-fixture",
      accountPublicMaterialDigestSha256: frameBundle.accountPublicMaterialDigestSha256,
      capturePolicyId: frameBundle.policyId,
      scenario: "happy_path",
      frameBundle,
      requestedAt: "2026-09-02T18:00:00Z",
      expiresAt: "2026-09-02T19:00:00Z",
      authentication: {
        scheme: "staging-ed25519",
        keyId: "pending",
        signatureBase64Url: "pending",
      },
    },
    gatewayBiometricSigner,
  );
}

async function makeReceipt(frameBundle: FrameBundleV0): Promise<SimulationReceiptV0> {
  return signArtifact(
    {
      kind: "simulation_receipt_v0",
      version: BIOMETRIC_VERIFICATION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
      receiptId: "receipt-fixture",
      requestId: "biometric-request-fixture",
      simulatorVersion: "simulator-fixture-v0",
      scenario: "happy_path",
      sessionId: frameBundle.sessionId,
      nonceDigestSha256: frameBundle.nonceDigestSha256,
      idempotencyKey: "biometric-idempotency-fixture",
      accountPublicMaterialDigestSha256: frameBundle.accountPublicMaterialDigestSha256,
      capturePolicyId: frameBundle.policyId,
      artifactDigestSha256: frameBundle.artifactDigestSha256,
      outcome: "simulated_pass",
      reasonCode: "scenario_happy_path",
      issuedAt: "2026-09-02T18:00:00Z",
      expiresAt: "2026-09-02T19:00:00Z",
      authentication: {
        scheme: "staging-ed25519",
        keyId: "pending",
        signatureBase64Url: "pending",
      },
    },
    biometricReceiptSigner,
  );
}

async function makeIssuanceRequest(
  receipt: SimulationReceiptV0,
): Promise<StagingIssuanceSimulationRequestV0> {
  return signArtifact(
    {
      kind: STAGING_ISSUANCE_SIMULATION_REQUEST_V0,
      version: STAGING_ISSUANCE_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      audience: STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
      requestId: "issuance-request-fixture",
      sessionId: receipt.sessionId,
      nonceDigestSha256: receipt.nonceDigestSha256,
      idempotencyKey: "issuance-idempotency-fixture",
      accountId: "account-fixture",
      accountPublicMaterialDigestSha256: receipt.accountPublicMaterialDigestSha256,
      biometricReceipt: receipt as SimulationReceiptV0 & { readonly outcome: "simulated_pass" },
      scenario: "issue_success",
      requestedAt: "2026-09-02T18:00:00Z",
      expiresAt: "2026-09-02T19:00:00Z",
      authentication: {
        scheme: "staging-ed25519",
        keyId: "pending",
        signatureBase64Url: "pending",
      },
    },
    gatewayIssuanceSigner,
  );
}

async function makeCredential(
  receipt: SimulationReceiptV0,
): Promise<SimulatedStagingCredentialV0> {
  return signArtifact(
    {
      kind: SIMULATED_STAGING_CREDENTIAL_V0,
      version: STAGING_ISSUANCE_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      credentialId: "credential-fixture",
      issuer: SIMULATED_STAGING_ISSUER_V0,
      audience: SIMULATED_STAGING_AUDIENCE_V0,
      issuanceRequestId: "issuance-request-fixture",
      idempotencyKey: "issuance-idempotency-fixture",
      nonceDigestSha256: receipt.nonceDigestSha256,
      subjectAccountId: "account-fixture",
      accountPublicMaterialDigestSha256: receipt.accountPublicMaterialDigestSha256,
      simulationReceiptId: receipt.receiptId,
      claims: {
        biometricVerification: "simulated_not_performed",
        uniqueness: "not_performed",
        credentialClass: "not_selfie_check",
      },
      issuedAt: "2026-09-02T18:00:00Z",
      expiresAt: "2026-09-02T19:00:00Z",
      authentication: {
        scheme: "staging-ed25519",
        keyId: "pending",
        signatureBase64Url: "pending",
      },
    },
    issuanceCredentialSigner,
  );
}

describe("the eight frozen interfaces", () => {
  test("pins the approved PRF mapping without a secret wire field", () => {
    const policy: WebAuthnPrfAuthenticatorPolicyV1 = {
      version: WEB_AUTHN_PRF_AUTHENTICATOR_V1,
      rpId: "auth.example.test",
      allowedOrigins: ["https://auth.example.test"],
      userVerification: "required",
      prfInputSha256: PRF_INPUT_V1_SHA256,
      prfOutputMapping: "verbatim_32_byte_first_result_to_world_id_4_signer_seed",
      secretLifecycle: "browser_memory_only",
    };
    expect(policy.prfInputSha256).toBe(
      "0b2ba181b397d6ac08ef7139cd2410c31fd416120d35f075420a4af38f3609e6",
    );
    expect(Object.keys(policy)).not.toContain("prfOutput");
    expect(Object.keys(policy)).not.toContain("privateKey");
    expect(Object.keys(policy)).not.toContain("seed32");
  });

  test("separates biometric and issuance simulation transitions in V2", () => {
    const session: EnrollmentSessionV2 = {
      version: ENROLLMENT_SESSION_V2,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      sessionId: "session-fixture",
      rpRequestDigestSha256: ZERO_HASH,
      accountPublicMaterialDigestSha256: ONE_HASH,
      nonceBase64Url: "nonce-fixture",
      idempotencyKey: "idempotency-fixture",
      biometricScenario: "happy_path",
      issuanceScenario: "issue_success",
      state: "created",
      createdAt: "2026-09-02T18:00:00Z",
      expiresAt: "2026-09-02T19:00:00Z",
    };
    expect(session.mode).toBe("simulation");
    expect(
      isEnrollmentTransitionAllowedV2("biometric_simulation_pending", "simulated_pass"),
    ).toBe(true);
    expect(
      isEnrollmentTransitionAllowedV2(
        "issuance_simulation_pending",
        "simulated_issuance_reject",
      ),
    ).toBe(true);
    expect(
      isEnrollmentTransitionAllowedV2(
        "issuance_simulation_pending",
        "simulated_issuance_unavailable",
      ),
    ).toBe(true);
    expect(isEnrollmentTransitionAllowedV2("simulated_pass", "simulated_credential_ready")).toBe(
      false,
    );
    expect(
      isEnrollmentTransitionAllowedV2("simulated_issuance_reject", "simulated_reject"),
    ).toBe(false);
  });

  test("recomputes the artifact digest and rejects unknown media fields", async () => {
    const bundle = await makeFrameBundle();
    expect(validateSimulationCapturePolicyV0(capturePolicy)).toEqual([]);
    expect(await validateFrameBundleV0(bundle, capturePolicy)).toEqual([]);
    expect(bundle.artifactDigestSha256).toBe(
      "4f3b997f844b8551e27bc311e987d45d7bf5315a3d29fc6576af3079caf4e153",
    );
    const wrongDigest = { ...bundle, artifactDigestSha256: ZERO_HASH };
    expect(await validateFrameBundleV0(wrongDigest, capturePolicy)).toContain(
      "artifactDigestMismatch",
    );
    const withPixels = { ...bundle, pixels: "forbidden" };
    expect(await validateFrameBundleV0(withPixels, capturePolicy)).toContain("unknown.pixels");
    const nonCanonicalUnknown = { ...bundle, pixels: 1n };
    expect(await validateFrameBundleV0(nonCanonicalUnknown, capturePolicy)).toEqual(
      expect.arrayContaining(["unknown.pixels", "artifactCanonicalization"]),
    );
  });

  test("detects one-field mutations across the artifact binding", async () => {
    const bundle = await makeFrameBundle();
    const mutations: unknown[] = [
      { ...bundle, sessionId: "session-other" },
      { ...bundle, policyId: "policy-other" },
      { ...bundle, accountPublicMaterialDigestSha256: ONE_HASH },
      { ...bundle, nonceDigestSha256: ZERO_HASH },
      { ...bundle, dataMode: "synthetic_fixture", syntheticFixtureId: "fixture" },
      { ...bundle, frames: [{ ...bundle.frames[0], width: 641 }] },
      { ...bundle, frames: [{ ...bundle.frames[0], frameDigestSha256: ONE_HASH }] },
    ];
    for (const mutation of mutations) {
      expect(await validateFrameBundleV0(mutation, capturePolicy)).toContain(
        "artifactDigestMismatch",
      );
    }
  });

  test("keeps client quality explicitly UX-only", () => {
    const policy: ClientQualityPolicyV0 = {
      version: CLIENT_QUALITY_POLICY_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      policyId: "quality-policy-fixture",
      purpose: "capture_ux_only",
      checks: [
        { kind: "camera_active" },
        { kind: "single_face" },
        {
          kind: "framing",
          minFaceAreaRatio: 0.15,
          maxFaceAreaRatio: 0.7,
          maxCenterOffsetRatio: 0.2,
        },
      ],
      maxRetakes: 2,
    };
    expect(validateClientQualityPolicyV0(policy)).toEqual([]);
    expect(JSON.stringify(policy)).not.toMatch(/spoof|verified|liveness/i);
  });

  test("authenticates the server-selected biometric scenario and all bindings", async () => {
    const bundle = await makeFrameBundle();
    const request = await makeBiometricRequest(bundle);
    const expected = {
      runtimeEnvironment: "staging" as const,
      requestId: request.requestId,
      sessionId: request.sessionId,
      nonceDigestSha256: request.nonceDigestSha256,
      idempotencyKey: request.idempotencyKey,
      accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
      capturePolicyId: request.capturePolicyId,
      scenario: request.scenario,
      now: NOW,
    };
    expect(
      await verifyBiometricSimulationRequestV0(
        request,
        expected,
        capturePolicy,
        gatewayBiometricSigner.trustRoot,
      ),
    ).toBe(true);
    expect(
      await verifyBiometricSimulationRequestV0(
        { ...request, scenario: "spoof_reject" },
        expected,
        capturePolicy,
        gatewayBiometricSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyBiometricSimulationRequestV0(
        request,
        { ...expected, capturePolicyId: "policy-other" },
        capturePolicy,
        gatewayBiometricSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyBiometricSimulationRequestV0(
        { ...request, audience: "wrong-audience" },
        expected,
        capturePolicy,
        gatewayBiometricSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyBiometricSimulationRequestV0(
        request,
        { ...expected, now: "2026-09-02T19:00:00Z" },
        capturePolicy,
        gatewayBiometricSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyBiometricSimulationRequestV0(
        request,
        { ...expected, nonceDigestSha256: ZERO_HASH },
        capturePolicy,
        gatewayBiometricSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyBiometricSimulationRequestV0(
        request,
        expected,
        capturePolicy,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);
  });

  test("strictly parses and verifies simulation receipts", async () => {
    const bundle = await makeFrameBundle();
    const receipt = await makeReceipt(bundle);
    const expected = {
      runtimeEnvironment: "staging" as const,
      receiptId: receipt.receiptId,
      requestId: receipt.requestId,
      sessionId: receipt.sessionId,
      nonceDigestSha256: receipt.nonceDigestSha256,
      idempotencyKey: receipt.idempotencyKey,
      accountPublicMaterialDigestSha256: receipt.accountPublicMaterialDigestSha256,
      capturePolicyId: receipt.capturePolicyId,
      scenario: receipt.scenario,
      artifactDigestSha256: receipt.artifactDigestSha256,
      now: NOW,
    };
    expect(isSimulationReceiptV0(receipt)).toBe(true);
    expect(
      await verifySimulationReceiptV0(receipt, expected, biometricReceiptSigner.trustRoot),
    ).toBe(true);
    const { authentication: _authentication, ...withoutAuthentication } = receipt;
    expect(isSimulationReceiptV0(withoutAuthentication)).toBe(false);
    expect(
      isSimulationReceiptV0({
        ...receipt,
        scenario: "spoof_reject",
        outcome: "simulated_pass",
      }),
    ).toBe(false);
    expect(
      await verifySimulationReceiptV0(
        { ...receipt, idempotencyKey: "tampered" },
        expected,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifySimulationReceiptV0(
        receipt,
        { ...expected, capturePolicyId: "policy-other" },
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);
    expect(isSimulationReceiptV0({ ...receipt, audience: "wrong-audience" })).toBe(false);
    expect(isSimulationReceiptV0({ ...receipt, unexpected: true })).toBe(false);
  });

  test("authenticates issuance scenarios and requires a simulated pass", async () => {
    const bundle = await makeFrameBundle();
    const receipt = await makeReceipt(bundle);
    const request = await makeIssuanceRequest(receipt);
    const expected = {
      runtimeEnvironment: "staging" as const,
      requestId: request.requestId,
      sessionId: request.sessionId,
      nonceDigestSha256: request.nonceDigestSha256,
      idempotencyKey: request.idempotencyKey,
      accountId: request.accountId,
      accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
      biometricReceipt: {
        runtimeEnvironment: "staging" as const,
        receiptId: receipt.receiptId,
        requestId: receipt.requestId,
        sessionId: receipt.sessionId,
        nonceDigestSha256: receipt.nonceDigestSha256,
        idempotencyKey: receipt.idempotencyKey,
        accountPublicMaterialDigestSha256: receipt.accountPublicMaterialDigestSha256,
        capturePolicyId: receipt.capturePolicyId,
        scenario: receipt.scenario,
        artifactDigestSha256: receipt.artifactDigestSha256,
        now: NOW,
      },
      scenario: request.scenario,
      now: NOW,
    };
    expect(
      await verifyStagingIssuanceSimulationRequestV0(
        request,
        expected,
        gatewayIssuanceSigner.trustRoot,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(true);
    expect(
      await verifyStagingIssuanceSimulationRequestV0(
        { ...request, scenario: "issue_reject" },
        expected,
        gatewayIssuanceSigner.trustRoot,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyStagingIssuanceSimulationRequestV0(
        request,
        { ...expected, idempotencyKey: "idempotency-other" },
        gatewayIssuanceSigner.trustRoot,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyStagingIssuanceSimulationRequestV0(
        { ...request, audience: "wrong-audience" },
        expected,
        gatewayIssuanceSigner.trustRoot,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyStagingIssuanceSimulationRequestV0(
        {
          ...request,
          biometricReceipt: {
            ...receipt,
            scenario: "spoof_reject",
            outcome: "simulated_reject",
            reasonCode: "scenario_spoof_reject",
          },
        },
        expected,
        gatewayIssuanceSigner.trustRoot,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);

    const invalidlySignedReceipt = {
      ...receipt,
      authentication: { ...receipt.authentication, signatureBase64Url: "not-a-signature" },
    } as SimulationReceiptV0 & { readonly outcome: "simulated_pass" };
    const requestWithInvalidReceipt = await signArtifact(
      { ...request, biometricReceipt: invalidlySignedReceipt },
      gatewayIssuanceSigner,
    );
    expect(
      await verifyStagingIssuanceSimulationRequestV0(
        requestWithInvalidReceipt,
        expected,
        gatewayIssuanceSigner.trustRoot,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);

    const expiredReceipt = await signArtifact(
      {
        ...receipt,
        issuedAt: "2026-09-02T16:00:00Z",
        expiresAt: "2026-09-02T17:00:00Z",
      },
      biometricReceiptSigner,
    );
    const requestWithExpiredReceipt = await signArtifact(
      {
        ...request,
        biometricReceipt: expiredReceipt as SimulationReceiptV0 & {
          readonly outcome: "simulated_pass";
        },
      },
      gatewayIssuanceSigner,
    );
    expect(
      await verifyStagingIssuanceSimulationRequestV0(
        requestWithExpiredReceipt,
        expected,
        gatewayIssuanceSigner.trustRoot,
        biometricReceiptSigner.trustRoot,
      ),
    ).toBe(false);
    expect(
      await verifyStagingIssuanceSimulationRequestV0(
        request,
        expected,
        gatewayIssuanceSigner.trustRoot,
        gatewayBiometricSigner.trustRoot,
      ),
    ).toBe(false);
  });

  test("strictly verifies the simulated credential and exact non-claims", async () => {
    const bundle = await makeFrameBundle();
    const receipt = await makeReceipt(bundle);
    const credential = await makeCredential(receipt);
    const expected = {
      runtimeEnvironment: "staging" as const,
      issuanceRequestId: credential.issuanceRequestId,
      idempotencyKey: credential.idempotencyKey,
      nonceDigestSha256: credential.nonceDigestSha256,
      subjectAccountId: credential.subjectAccountId,
      accountPublicMaterialDigestSha256: credential.accountPublicMaterialDigestSha256,
      simulationReceiptId: credential.simulationReceiptId,
      now: NOW,
    };
    expect(isSimulatedStagingCredentialV0(credential)).toBe(true);
    expect(
      await verifySimulatedStagingCredentialV0(
        credential,
        expected,
        issuanceCredentialSigner.trustRoot,
      ),
    ).toBe(true);
    expect(
      isSimulatedStagingCredentialV0({
        ...credential,
        claims: {
          biometricVerification: "verified",
          uniqueness: "not_performed",
          credentialClass: "selfie_check",
        },
      }),
    ).toBe(false);
    const { authentication: _authentication, ...withoutAuthentication } = credential;
    expect(isSimulatedStagingCredentialV0(withoutAuthentication)).toBe(false);
    expect(isSimulatedStagingCredentialV0({ ...credential, audience: "wrong-audience" })).toBe(
      false,
    );
    expect(isSimulatedStagingCredentialV0({ ...credential, unexpected: true })).toBe(false);
    expect(
      await verifySimulatedStagingCredentialV0(
        credential,
        { ...expected, now: "2026-09-02T19:00:00Z" },
        issuanceCredentialSigner.trustRoot,
      ),
    ).toBe(false);
  });

  test("requires World ID staging configuration without inventing an endpoint", () => {
    const unresolvedPolicy: WorldIdRegistrationAdapterPolicyV1 = {
      version: WORLD_ID_REGISTRATION_ADAPTER_V1,
      environment: SIMULATION_ENVIRONMENT,
      sdkRevision: "required-at-runtime",
      gatewayBaseUrl: "required-at-runtime",
      chainId: 0,
      gatewayRecomputesOrRejectsCommitmentMismatch: true,
      endpointConfigurationHasNoDefault: true,
    };
    expect(validateWorldIdRegistrationAdapterPolicyV1(unresolvedPolicy)).toEqual([
      "sdkRevision",
      "gatewayBaseUrl",
      "chainId",
    ]);
  });
});

describe("production isolation", () => {
  test("rejects a simulation receipt before reading outcome or authentication", () => {
    let outcomeWasRead = false;
    let authenticationWasRead = false;
    const value: Record<string, unknown> = {
      kind: "simulation_receipt_v0",
      mode: "simulation",
      environment: "staging",
    };
    Object.defineProperty(value, "outcome", {
      enumerable: true,
      get() {
        outcomeWasRead = true;
        return "simulated_pass";
      },
    });
    Object.defineProperty(value, "authentication", {
      enumerable: true,
      get() {
        authenticationWasRead = true;
        return {};
      },
    });

    expect(() => assertSimulationArtifactAllowed("production", value)).toThrow(
      SimulationArtifactInProductionError,
    );
    expect(outcomeWasRead).toBe(false);
    expect(authenticationWasRead).toBe(false);
  });

  test("rejects a simulated credential and permits it only outside production", async () => {
    const credential = await makeCredential(await makeReceipt(await makeFrameBundle()));
    expect(() => assertSimulationArtifactAllowed("production", credential)).toThrow(
      SimulationArtifactInProductionError,
    );
    expect(() => assertSimulationArtifactAllowed("staging", credential)).not.toThrow();
  });
});
