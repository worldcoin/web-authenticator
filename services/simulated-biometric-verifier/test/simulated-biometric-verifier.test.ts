import { beforeAll, describe, expect, test } from "bun:test";
import {
  BIOMETRIC_SCENARIO_OUTCOME_V0,
  BIOMETRIC_SCENARIO_REASON_V0,
  BIOMETRIC_SIMULATION_REQUEST_V0,
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  BIOMETRIC_VERIFICATION_PORT_V0,
  bytesToArrayBuffer,
  bytesToBase64Url,
  computeFrameBundleDigestV0,
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  SIMULATION_CAPTURE_POLICY_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  stagingSignaturePreimageV0,
  verifySimulationReceiptV0,
  type BiometricSimulationRequestV0,
  type BiometricSimulationScenarioV0,
  type ExpectedBiometricSimulationRequestV0,
  type FrameBundleV0,
  type HexSha256,
  type SimulationCapturePolicyV0,
  type StagingAuthenticationV0,
  type StagingEd25519TrustRootV0,
} from "../../../packages/contracts/src";
import { SimulatedBiometricVerifierV0, type SimulatorAuditEventV0 } from "../src";

const ZERO_HASH = "0".repeat(64) as HexSha256;
const ONE_HASH = "1".repeat(64) as HexSha256;
const TWO_HASH = "2".repeat(64) as HexSha256;
const NOW = new Date("2026-09-02T18:30:00.000Z");

interface TestSigner {
  readonly privateKey: CryptoKey;
  readonly trustRoot: StagingEd25519TrustRootV0;
}

let gatewaySigner: TestSigner;
let receiptSigner: TestSigner;
let wrongSigner: TestSigner;

async function createSigner(audience: string, keyId: string): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    privateKey: pair.privateKey,
    trustRoot: {
      environment: SIMULATION_ENVIRONMENT,
      audience,
      keyId,
      publicKeyRawBase64Url: bytesToBase64Url(raw),
    },
  };
}

async function sign<T extends { readonly authentication: StagingAuthenticationV0 }>(
  artifact: T,
  signer: TestSigner,
): Promise<T> {
  const unsigned = {
    ...artifact,
    authentication: {
      scheme: "staging-ed25519" as const,
      keyId: signer.trustRoot.keyId,
      signatureBase64Url: "pending",
    },
  };
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    signer.privateKey,
    bytesToArrayBuffer(stagingSignaturePreimageV0(unsigned as unknown as Record<string, unknown>)),
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
  [gatewaySigner, receiptSigner, wrongSigner] = await Promise.all([
    createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "gateway-biometric-key"),
    createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "receipt-biometric-key"),
    createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "wrong-key"),
  ]);
});

function policy(dataMode: "metadata_only" | "synthetic_fixture" = "metadata_only"): SimulationCapturePolicyV0 {
  return {
    version: SIMULATION_CAPTURE_POLICY_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    policyId: `capture-policy-${dataMode}`,
    dataMode,
    encoding: "rgba8",
    minFrames: 1,
    maxFrames: 2,
    maxWidth: 1024,
    maxHeight: 1024,
    maxFrameBytes: 4_194_304,
    maxTotalBytes: 8_388_608,
    captureOffsetsAreDiagnosticOnly: true,
    arrayOrderHasBiometricMeaning: false,
    qualityPolicyId: "quality-policy-v0",
    expiresAt: "2026-09-02T19:00:00.000Z",
  };
}

async function bundle(
  selectedPolicy: SimulationCapturePolicyV0 = policy(),
  frameDigest: HexSha256 = ZERO_HASH,
): Promise<FrameBundleV0> {
  const pending: FrameBundleV0 = {
    kind: FRAME_BUNDLE_V0,
    mode: SIMULATION_MODE,
    sessionId: "session-1",
    policyId: selectedPolicy.policyId,
    accountPublicMaterialDigestSha256: ONE_HASH,
    nonceDigestSha256: TWO_HASH,
    dataMode: selectedPolicy.dataMode,
    frames: [{
      transportIndex: 0,
      width: 640,
      height: 480,
      encoding: "rgba8",
      byteLength: 1_228_800,
      frameDigestSha256: frameDigest,
      captureOffsetMs: 0,
    }],
    ...(selectedPolicy.dataMode === "synthetic_fixture" ? { syntheticFixtureId: "fixture-neutral-v1" } : {}),
    totalByteLength: 1_228_800,
    digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
    artifactDigestSha256: ZERO_HASH,
  };
  return { ...pending, artifactDigestSha256: await computeFrameBundleDigestV0(pending) };
}

async function request(
  scenario: BiometricSimulationScenarioV0 = "happy_path",
  selectedBundle?: FrameBundleV0,
  overrides: Partial<BiometricSimulationRequestV0> = {},
  signer: TestSigner = gatewaySigner,
): Promise<BiometricSimulationRequestV0> {
  const frameBundle = selectedBundle ?? await bundle();
  return sign({
    kind: BIOMETRIC_SIMULATION_REQUEST_V0,
    version: BIOMETRIC_VERIFICATION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
    requestId: "biometric-request-1",
    sessionId: frameBundle.sessionId,
    nonceDigestSha256: frameBundle.nonceDigestSha256,
    idempotencyKey: "biometric-idempotency-1",
    accountPublicMaterialDigestSha256: frameBundle.accountPublicMaterialDigestSha256,
    capturePolicyId: frameBundle.policyId,
    scenario,
    frameBundle,
    requestedAt: "2026-09-02T18:00:00.000Z",
    expiresAt: "2026-09-02T19:00:00.000Z",
    authentication: { scheme: "staging-ed25519", keyId: "pending", signatureBase64Url: "pending" },
    ...overrides,
  }, signer);
}

function expected(
  value: BiometricSimulationRequestV0,
): ExpectedBiometricSimulationRequestV0 {
  return {
    runtimeEnvironment: "staging",
    requestId: value.requestId,
    sessionId: value.sessionId,
    nonceDigestSha256: value.nonceDigestSha256,
    idempotencyKey: value.idempotencyKey,
    accountPublicMaterialDigestSha256: value.accountPublicMaterialDigestSha256,
    capturePolicyId: value.capturePolicyId,
    scenario: value.scenario,
    now: NOW.toISOString(),
  };
}

function service(
  audit?: (event: SimulatorAuditEventV0) => void,
  maxCacheEntries = 100,
): SimulatedBiometricVerifierV0 {
  return new SimulatedBiometricVerifierV0({
    runtimeEnvironment: "staging",
    gatewayTrustRoot: gatewaySigner.trustRoot,
    receiptSigner: {
      environment: SIMULATION_ENVIRONMENT,
      audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
      keyId: receiptSigner.trustRoot.keyId,
      privateKey: receiptSigner.privateKey,
    },
    simulatorVersion: "deterministic-biometric-simulator-v0",
    receiptTtlMs: 600_000,
    maxCacheEntries,
    allowedSyntheticFixtureIds: ["fixture-neutral-v1"],
    now: () => NOW,
    audit,
  });
}

describe("deterministic scenario mapping", () => {
  for (const scenario of ["happy_path", "spoof_reject", "capture_retry", "dependency_unavailable"] as const) {
    test(`${scenario} maps to its one frozen outcome`, async () => {
      const value = await request(scenario);
      const result = await service().verify({ request: value, expected: expected(value), capturePolicy: policy() });
      expect(result.kind).toBe("simulation_receipt_ready_v0");
      if (result.kind !== "simulation_receipt_ready_v0") return;
      expect(result.receipt.outcome).toBe(BIOMETRIC_SCENARIO_OUTCOME_V0[scenario]);
      expect(result.receipt.reasonCode).toBe(BIOMETRIC_SCENARIO_REASON_V0[scenario]);
      expect(result.receipt.scenario).toBe(scenario);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.receipt)).toBe(true);
      expect(Object.isFrozen(result.receipt.authentication)).toBe(true);
      expect(await verifySimulationReceiptV0(result.receipt, {
        ...expected(value),
        receiptId: result.receipt.receiptId,
        artifactDigestSha256: value.frameBundle.artifactDigestSha256,
        now: NOW.toISOString(),
      }, receiptSigner.trustRoot)).toBe(true);
    });
  }

  test("metadata and named fixtures are accepted without affecting the selected outcome", async () => {
    const metadataRequest = await request("spoof_reject", await bundle(policy(), ZERO_HASH));
    const fixturePolicy = policy("synthetic_fixture");
    const fixtureRequest = await request("spoof_reject", await bundle(fixturePolicy, TWO_HASH), {
      requestId: "biometric-request-fixture",
      idempotencyKey: "biometric-idempotency-fixture",
    });
    const verifier = service();
    const metadata = await verifier.verify({ request: metadataRequest, expected: expected(metadataRequest), capturePolicy: policy() });
    const fixture = await verifier.verify({ request: fixtureRequest, expected: expected(fixtureRequest), capturePolicy: fixturePolicy });
    expect(metadata.kind).toBe("simulation_receipt_ready_v0");
    expect(fixture.kind).toBe("simulation_receipt_ready_v0");
    if (metadata.kind === "simulation_receipt_ready_v0" && fixture.kind === "simulation_receipt_ready_v0") {
      expect(metadata.receipt.outcome).toBe("simulated_reject");
      expect(fixture.receipt.outcome).toBe("simulated_reject");
      expect(metadata.receipt.artifactDigestSha256).not.toBe(fixture.receipt.artifactDigestSha256);
    }
  });
});

describe("strict authentication and bindings", () => {
  test("rejects wrong signer, audience, expiry, and server-owned scenario mismatch", async () => {
    const base = await request();
    const wrongKey = await request("happy_path", base.frameBundle, {}, wrongSigner);
    const wrongAudience = await request("happy_path", base.frameBundle, {
      audience: "wrong-audience" as typeof BIOMETRIC_SIMULATOR_AUDIENCE_V0,
    });
    const expired = await request("happy_path", base.frameBundle, { expiresAt: "2026-09-02T18:29:59.000Z" });
    const wrongMode = await request("happy_path", base.frameBundle, { mode: "production" as typeof SIMULATION_MODE });
    const wrongEnvironment = await request("happy_path", base.frameBundle, { environment: "production" as typeof SIMULATION_ENVIRONMENT });
    const verifier = service();
    for (const candidate of [wrongKey, wrongAudience, expired, wrongMode, wrongEnvironment]) {
      expect(await verifier.verify({ request: candidate, expected: expected(candidate), capturePolicy: policy() })).toEqual({
        kind: "biometric_simulation_error_v0",
        reasonCode: "invalid_request",
      });
    }
    expect(await verifier.verify({ request: base, expected: { ...expected(base), scenario: "spoof_reject" }, capturePolicy: policy() })).toEqual({
      kind: "biometric_simulation_error_v0",
      reasonCode: "invalid_request",
    });
  });

  test("rejects nonce, account, policy, artifact, and unknown-field mutations", async () => {
    const valid = await request();
    const mutatedBundle = { ...valid.frameBundle, artifactDigestSha256: ZERO_HASH };
    const cases: Array<[unknown, ExpectedBiometricSimulationRequestV0]> = [
      [valid, { ...expected(valid), nonceDigestSha256: ZERO_HASH }],
      [valid, { ...expected(valid), idempotencyKey: "wrong-idempotency" }],
      [valid, { ...expected(valid), accountPublicMaterialDigestSha256: ZERO_HASH }],
      [valid, { ...expected(valid), capturePolicyId: "wrong-policy" }],
      [await request("happy_path", mutatedBundle), expected(await request("happy_path", mutatedBundle))],
      [{ ...valid, browserSpoofScore: 0 }, expected(valid)],
      [{ ...valid, pixelsBase64: "forbidden" }, expected(valid)],
      [{ ...valid, privateKey: "forbidden" }, expected(valid)],
    ];
    for (const [candidate, candidateExpected] of cases) {
      expect(await service().verify({ request: candidate, expected: candidateExpected, capturePolicy: policy() })).toMatchObject({
        kind: "biometric_simulation_error_v0",
        reasonCode: "invalid_request",
      });
    }
  });

  test("rejects arbitrary synthetic fixture identifiers and URLs", async () => {
    const fixturePolicy = policy("synthetic_fixture");
    for (const fixtureId of ["unregistered-fixture", "https://example.test/camera.png"]) {
      const original = await bundle(fixturePolicy);
      const pending = { ...original, syntheticFixtureId: fixtureId, artifactDigestSha256: ZERO_HASH };
      const changed = { ...pending, artifactDigestSha256: await computeFrameBundleDigestV0(pending) };
      const value = await request("happy_path", changed);
      expect(await service().verify({ request: value, expected: expected(value), capturePolicy: fixturePolicy })).toEqual({
        kind: "biometric_simulation_error_v0",
        reasonCode: "invalid_request",
      });
    }
  });
});

describe("idempotency, isolation, readiness, and redaction", () => {
  test("returns the exact cached receipt after a lost response and detects conflicts/replay", async () => {
    const verifier = service();
    const firstRequest = await request();
    const first = await verifier.verify({ request: firstRequest, expected: expected(firstRequest), capturePolicy: policy() });
    const retry = await verifier.verify({ request: firstRequest, expected: expected(firstRequest), capturePolicy: policy() });
    expect(retry).toEqual(first);

    const conflict = await request("happy_path", firstRequest.frameBundle, { requestId: "biometric-request-conflict" });
    expect(await verifier.verify({ request: conflict, expected: expected(conflict), capturePolicy: policy() })).toMatchObject({ reasonCode: "idempotency_conflict" });
    const replay = await request("happy_path", firstRequest.frameBundle, { idempotencyKey: "biometric-idempotency-replay" });
    expect(await verifier.verify({ request: replay, expected: expected(replay), capturePolicy: policy() })).toMatchObject({ reasonCode: "request_replay" });
  });

  test("bounds retained idempotency records", async () => {
    const verifier = service(undefined, 1);
    const first = await request();
    expect((await verifier.verify({ request: first, expected: expected(first), capturePolicy: policy() })).kind).toBe("simulation_receipt_ready_v0");
    const second = await request("happy_path", first.frameBundle, {
      requestId: "biometric-request-2",
      idempotencyKey: "biometric-idempotency-2",
    });
    expect(await verifier.verify({ request: second, expected: expected(second), capturePolicy: policy() })).toEqual({
      kind: "biometric_simulation_error_v0",
      reasonCode: "service_not_ready",
    });
  });

  test("rejects production before reading request outcome or authentication", async () => {
    let reads = 0;
    const sentinel = new Proxy({}, { get(_target, property) {
      if (property === "outcome" || property === "authentication" || property === "scenario") reads += 1;
      throw new Error("sensitive getter read");
    } });
    const production = new SimulatedBiometricVerifierV0({
      runtimeEnvironment: "production",
      gatewayTrustRoot: gatewaySigner.trustRoot,
      receiptSigner: {
        environment: SIMULATION_ENVIRONMENT,
        audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
        keyId: receiptSigner.trustRoot.keyId,
        privateKey: receiptSigner.privateKey,
      },
      simulatorVersion: "disabled",
      receiptTtlMs: 1,
      maxCacheEntries: 1,
      allowedSyntheticFixtureIds: [],
      now: () => NOW,
    });
    await expect(production.verify({ request: sentinel, expected: sentinel as ExpectedBiometricSimulationRequestV0, capturePolicy: sentinel as SimulationCapturePolicyV0 })).rejects.toThrow("forbidden in production");
    expect(reads).toBe(0);
  });

  test("reports readiness failure without echoing key material", () => {
    const unavailable = new SimulatedBiometricVerifierV0({
      runtimeEnvironment: "staging",
      gatewayTrustRoot: { ...gatewaySigner.trustRoot, audience: "wrong" },
      receiptSigner: {
        environment: SIMULATION_ENVIRONMENT,
        audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
        keyId: receiptSigner.trustRoot.keyId,
        privateKey: receiptSigner.privateKey,
      },
      simulatorVersion: "v0",
      receiptTtlMs: 1,
      maxCacheEntries: 1,
      allowedSyntheticFixtureIds: [],
      now: () => NOW,
    });
    expect(unavailable.readiness()).toEqual({ ready: false, reasonCode: "service_not_ready" });
    expect(JSON.stringify(unavailable.readiness())).not.toContain(gatewaySigner.trustRoot.publicKeyRawBase64Url);
  });

  test("requires purpose-distinct signer key IDs", () => {
    const confused = new SimulatedBiometricVerifierV0({
      runtimeEnvironment: "staging",
      gatewayTrustRoot: gatewaySigner.trustRoot,
      receiptSigner: {
        environment: SIMULATION_ENVIRONMENT,
        audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
        keyId: gatewaySigner.trustRoot.keyId,
        privateKey: receiptSigner.privateKey,
      },
      simulatorVersion: "v0",
      receiptTtlMs: 1,
      maxCacheEntries: 1,
      allowedSyntheticFixtureIds: [],
      now: () => NOW,
    });
    expect(confused.readiness()).toEqual({ ready: false, reasonCode: "service_not_ready" });
  });

  test("audit output contains only allowlisted event and reason fields", async () => {
    const events: SimulatorAuditEventV0[] = [];
    const value = await request();
    const result = await service((event) => events.push(event)).verify({ request: value, expected: expected(value), capturePolicy: policy() });
    expect(result.kind).toBe("simulation_receipt_ready_v0");
    expect(events).toEqual([{ event: "receipt_created" }]);
    const serialized = JSON.stringify(events);
    for (const forbidden of [value.requestId, value.sessionId, value.accountPublicMaterialDigestSha256, value.authentication.signatureBase64Url, "privateKey", "pixels"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("swallows free-text audit transport failures", async () => {
    const value = await request();
    const result = await service(() => { throw new Error("secret upstream audit failure"); }).verify({
      request: value,
      expected: expected(value),
      capturePolicy: policy(),
    });
    expect(result.kind).toBe("simulation_receipt_ready_v0");
    expect(JSON.stringify(result)).not.toContain("secret upstream audit failure");
  });
});
