import { beforeAll, describe, expect, test } from "bun:test";
import {
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  BIOMETRIC_VERIFICATION_PORT_V0,
  bytesToArrayBuffer,
  bytesToBase64Url,
  SIMULATED_STAGING_AUDIENCE_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATION_RECEIPT_V0,
  stagingSignaturePreimageV0,
  STAGING_ISSUANCE_PORT_V0,
  STAGING_ISSUANCE_SIMULATION_REQUEST_V0,
  STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
  verifySimulatedStagingCredentialV0,
  type ExpectedSimulationReceiptV0,
  type ExpectedStagingIssuanceRequestV0,
  type HexSha256,
  type IssuanceSimulationScenarioV0,
  type SimulationReceiptV0,
  type StagingAuthenticationV0,
  type StagingEd25519TrustRootV0,
  type StagingIssuanceSimulationRequestV0,
} from "../../../packages/contracts/src";
import { SimulatedStagingIssuerV0, type IssuerAuditEventV0 } from "../src";

const ZERO_HASH = "0".repeat(64) as HexSha256;
const ONE_HASH = "1".repeat(64) as HexSha256;
const TWO_HASH = "2".repeat(64) as HexSha256;
const NOW = new Date("2026-09-02T18:30:00.000Z");

interface TestSigner {
  readonly privateKey: CryptoKey;
  readonly trustRoot: StagingEd25519TrustRootV0;
}

let biometricSigner: TestSigner;
let gatewaySigner: TestSigner;
let credentialSigner: TestSigner;
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
  [biometricSigner, gatewaySigner, credentialSigner, wrongSigner] = await Promise.all([
    createSigner(BIOMETRIC_SIMULATOR_AUDIENCE_V0, "biometric-receipt-key"),
    createSigner(STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0, "gateway-issuance-key"),
    createSigner(SIMULATED_STAGING_AUDIENCE_V0, "credential-key"),
    createSigner(STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0, "wrong-key"),
  ]);
});

async function receipt(
  overrides: Partial<SimulationReceiptV0> = {},
  signer: TestSigner = biometricSigner,
): Promise<SimulationReceiptV0> {
  return sign({
    kind: SIMULATION_RECEIPT_V0,
    version: BIOMETRIC_VERIFICATION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
    receiptId: "receipt-1",
    requestId: "biometric-request-1",
    simulatorVersion: "deterministic-biometric-simulator-v0",
    scenario: "happy_path",
    sessionId: "session-1",
    nonceDigestSha256: ONE_HASH,
    idempotencyKey: "biometric-idempotency-1",
    accountPublicMaterialDigestSha256: TWO_HASH,
    capturePolicyId: "capture-policy-1",
    artifactDigestSha256: ZERO_HASH,
    outcome: "simulated_pass",
    reasonCode: "scenario_happy_path",
    issuedAt: "2026-09-02T18:00:00.000Z",
    expiresAt: "2026-09-02T19:00:00.000Z",
    authentication: { scheme: "staging-ed25519", keyId: "pending", signatureBase64Url: "pending" },
    ...overrides,
  }, signer);
}

async function request(
  biometricReceipt: SimulationReceiptV0,
  scenario: IssuanceSimulationScenarioV0 = "issue_success",
  overrides: Partial<StagingIssuanceSimulationRequestV0> = {},
  signer: TestSigner = gatewaySigner,
): Promise<StagingIssuanceSimulationRequestV0> {
  return sign({
    kind: STAGING_ISSUANCE_SIMULATION_REQUEST_V0,
    version: STAGING_ISSUANCE_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    audience: STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
    requestId: "issuance-request-1",
    sessionId: biometricReceipt.sessionId,
    nonceDigestSha256: biometricReceipt.nonceDigestSha256,
    idempotencyKey: "issuance-idempotency-1",
    accountId: "account-1",
    accountPublicMaterialDigestSha256: biometricReceipt.accountPublicMaterialDigestSha256,
    biometricReceipt: biometricReceipt as SimulationReceiptV0 & { readonly outcome: "simulated_pass" },
    scenario,
    requestedAt: "2026-09-02T18:10:00.000Z",
    expiresAt: "2026-09-02T19:00:00.000Z",
    authentication: { scheme: "staging-ed25519", keyId: "pending", signatureBase64Url: "pending" },
    ...overrides,
  }, signer);
}

function expectedReceipt(value: SimulationReceiptV0): ExpectedSimulationReceiptV0 {
  return {
    runtimeEnvironment: "staging",
    receiptId: value.receiptId,
    requestId: value.requestId,
    sessionId: value.sessionId,
    nonceDigestSha256: value.nonceDigestSha256,
    idempotencyKey: value.idempotencyKey,
    accountPublicMaterialDigestSha256: value.accountPublicMaterialDigestSha256,
    capturePolicyId: value.capturePolicyId,
    scenario: value.scenario,
    artifactDigestSha256: value.artifactDigestSha256,
    now: NOW.toISOString(),
  };
}

function expected(value: StagingIssuanceSimulationRequestV0): ExpectedStagingIssuanceRequestV0 {
  return {
    runtimeEnvironment: "staging",
    requestId: value.requestId,
    sessionId: value.sessionId,
    nonceDigestSha256: value.nonceDigestSha256,
    idempotencyKey: value.idempotencyKey,
    accountId: value.accountId,
    accountPublicMaterialDigestSha256: value.accountPublicMaterialDigestSha256,
    biometricReceipt: expectedReceipt(value.biometricReceipt),
    scenario: value.scenario,
    now: NOW.toISOString(),
  };
}

function service(
  audit?: (event: IssuerAuditEventV0) => void,
  maxCacheEntries = 100,
): SimulatedStagingIssuerV0 {
  return new SimulatedStagingIssuerV0({
    runtimeEnvironment: "staging",
    gatewayTrustRoot: gatewaySigner.trustRoot,
    biometricReceiptTrustRoot: biometricSigner.trustRoot,
    credentialSigner: {
      environment: SIMULATION_ENVIRONMENT,
      audience: SIMULATED_STAGING_AUDIENCE_V0,
      keyId: credentialSigner.trustRoot.keyId,
      privateKey: credentialSigner.privateKey,
    },
    credentialTtlMs: 600_000,
    maxCacheEntries,
    now: () => NOW,
    audit,
  });
}

describe("issuance scenarios and credential shape", () => {
  test("issues the exact staging-only non-credential after a valid pass", async () => {
    const pass = await receipt();
    const value = await request(pass);
    const result = await service().issue({ request: value, expected: expected(value) });
    expect(result.kind).toBe("simulated_credential_ready_v0");
    if (result.kind !== "simulated_credential_ready_v0") return;
    expect(result.credential).toMatchObject({
      kind: "simulated_staging_credential_v0",
      mode: "simulation",
      environment: "staging",
      issuer: "world_id_web_authenticator_simulator",
      audience: "world_id_web_authenticator_staging",
      subjectAccountId: value.accountId,
      simulationReceiptId: pass.receiptId,
      claims: {
        biometricVerification: "simulated_not_performed",
        uniqueness: "not_performed",
        credentialClass: "not_selfie_check",
      },
    });
    expect(Object.keys(result.credential.claims).sort()).toEqual(["biometricVerification", "credentialClass", "uniqueness"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.credential)).toBe(true);
    expect(Object.isFrozen(result.credential.claims)).toBe(true);
    expect(Object.isFrozen(result.credential.authentication)).toBe(true);
    expect(await verifySimulatedStagingCredentialV0(result.credential, {
      runtimeEnvironment: "staging",
      issuanceRequestId: value.requestId,
      idempotencyKey: value.idempotencyKey,
      nonceDigestSha256: value.nonceDigestSha256,
      subjectAccountId: value.accountId,
      accountPublicMaterialDigestSha256: value.accountPublicMaterialDigestSha256,
      simulationReceiptId: pass.receiptId,
      now: NOW.toISOString(),
    }, credentialSigner.trustRoot)).toBe(true);
    for (const forbidden of ["selfie_check", "proof", "attestation", "embedding", "shares", "biometric_passed"]) {
      expect(Object.keys(result.credential).join(",")).not.toContain(forbidden);
    }
  });

  for (const [scenario, kind, reasonCode] of [
    ["issue_reject", "simulated_issuance_rejected_v0", "scenario_issue_reject"],
    ["issue_unavailable", "simulated_issuance_unavailable_v0", "scenario_issue_unavailable"],
  ] as const) {
    test(`${scenario} returns its exact frozen result`, async () => {
      const pass = await receipt();
      const value = await request(pass, scenario);
      const result = await service().issue({ request: value, expected: expected(value) });
      expect(result.kind).toBe(kind);
      expect("reasonCode" in result ? result.reasonCode : undefined).toBe(reasonCode);
    });
  }

  test("rejects every non-pass receipt before issuance", async () => {
    for (const [scenario, outcome, reasonCode] of [
      ["spoof_reject", "simulated_reject", "scenario_spoof_reject"],
      ["capture_retry", "simulated_retry", "scenario_capture_retry"],
      ["dependency_unavailable", "simulated_unavailable", "scenario_dependency_unavailable"],
    ] as const) {
      const nonPass = await receipt({ scenario, outcome, reasonCode });
      const value = await request(nonPass);
      expect(await service().issue({ request: value, expected: expected(value) })).toEqual({
        kind: "staging_issuance_error_v0",
        reasonCode: "non_pass_receipt",
      });
    }
  });

  test("classifies only authenticated current non-pass receipts as non-pass", async () => {
    const validReject = await receipt({
      scenario: "spoof_reject",
      outcome: "simulated_reject",
      reasonCode: "scenario_spoof_reject",
    });
    const value = await request(validReject);
    expect(await service().issue({ request: value, expected: expected(value) })).toEqual({
      kind: "staging_issuance_error_v0",
      reasonCode: "non_pass_receipt",
    });
  });
});

describe("independent outer request and embedded receipt verification", () => {
  test("rejects wrong outer key, audience, expiry, and server scenario", async () => {
    const pass = await receipt();
    const wrongKey = await request(pass, "issue_success", {}, wrongSigner);
    const wrongAudience = await request(pass, "issue_success", { audience: "wrong" as typeof STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0 });
    const expired = await request(pass, "issue_success", { expiresAt: "2026-09-02T18:29:59.000Z" });
    const wrongMode = await request(pass, "issue_success", { mode: "production" as typeof SIMULATION_MODE });
    const wrongEnvironment = await request(pass, "issue_success", { environment: "production" as typeof SIMULATION_ENVIRONMENT });
    for (const value of [wrongKey, wrongAudience, expired, wrongMode, wrongEnvironment]) {
      expect(await service().issue({ request: value, expected: expected(value) })).toMatchObject({ reasonCode: "invalid_request" });
    }
    const valid = await request(pass);
    expect(await service().issue({ request: valid, expected: { ...expected(valid), scenario: "issue_reject" } })).toMatchObject({ reasonCode: "invalid_request" });
  });

  test("rejects an invalid, wrong-root, or expired embedded receipt even when the outer request is re-signed", async () => {
    const valid = await receipt();
    const invalidSignature = { ...valid, authentication: { ...valid.authentication, signatureBase64Url: `${valid.authentication.signatureBase64Url}x` } };
    const wrongRoot = await receipt({}, wrongSigner);
    const expired = await receipt({ issuedAt: "2026-09-02T17:00:00.000Z", expiresAt: "2026-09-02T18:29:59.000Z" });
    for (const embedded of [invalidSignature, wrongRoot, expired]) {
      const value = await request(embedded);
      expect(await service().issue({ request: value, expected: expected(value) })).toEqual({
        kind: "staging_issuance_error_v0",
        reasonCode: "invalid_request",
      });
    }
  });

  test("does not classify forged, wrong-root, expired, or binding-mismatched non-pass receipts", async () => {
    const validReject = await receipt({
      scenario: "spoof_reject",
      outcome: "simulated_reject",
      reasonCode: "scenario_spoof_reject",
    });
    const forged = {
      ...validReject,
      authentication: {
        ...validReject.authentication,
        signatureBase64Url: `${validReject.authentication.signatureBase64Url}x`,
      },
    };
    const wrongRoot = await receipt({
      scenario: "spoof_reject",
      outcome: "simulated_reject",
      reasonCode: "scenario_spoof_reject",
    }, wrongSigner);
    const expired = await receipt({
      scenario: "spoof_reject",
      outcome: "simulated_reject",
      reasonCode: "scenario_spoof_reject",
      issuedAt: "2026-09-02T17:00:00.000Z",
      expiresAt: "2026-09-02T18:29:59.000Z",
    });

    for (const embedded of [forged, wrongRoot, expired]) {
      const value = await request(embedded);
      expect(await service().issue({ request: value, expected: expected(value) })).toEqual({
        kind: "staging_issuance_error_v0",
        reasonCode: "invalid_request",
      });
    }

    const boundValue = await request(validReject);
    const bindingMismatch = {
      ...expected(boundValue),
      biometricReceipt: {
        ...expectedReceipt(validReject),
        artifactDigestSha256: ONE_HASH,
      },
    };
    expect(await service().issue({ request: boundValue, expected: bindingMismatch })).toEqual({
      kind: "staging_issuance_error_v0",
      reasonCode: "invalid_request",
    });
  });

  test("fails closed when receipt outcome changes after valid outer authentication", async () => {
    const validReject = await receipt({
      scenario: "spoof_reject",
      outcome: "simulated_reject",
      reasonCode: "scenario_spoof_reject",
    });
    const signedOuter = await request(validReject);
    let outcomeReads = 0;
    const hostileReceipt = { ...validReject } as SimulationReceiptV0;
    Object.defineProperty(hostileReceipt, "outcome", {
      enumerable: true,
      configurable: true,
      get: () => {
        outcomeReads += 1;
        if (outcomeReads === 1) return validReject.outcome;
        throw new Error("hostile outcome getter detail");
      },
    });
    const hostileOuter = { ...signedOuter, biometricReceipt: hostileReceipt };
    const result = await service().issue({ request: hostileOuter, expected: expected(signedOuter) });
    expect(result).toEqual({
      kind: "staging_issuance_error_v0",
      reasonCode: "invalid_request",
    });
    expect(outcomeReads).toBe(2);
    expect(JSON.stringify(result)).not.toContain("hostile outcome getter detail");
  });

  test("rejects session, nonce, account, artifact, receipt-id, and unknown-field mismatches", async () => {
    const pass = await receipt();
    const value = await request(pass);
    const mismatches: ExpectedStagingIssuanceRequestV0[] = [
      { ...expected(value), sessionId: "wrong-session" },
      { ...expected(value), nonceDigestSha256: ZERO_HASH },
      { ...expected(value), idempotencyKey: "wrong-idempotency" },
      { ...expected(value), accountId: "wrong-account" },
      { ...expected(value), accountPublicMaterialDigestSha256: ZERO_HASH },
      { ...expected(value), biometricReceipt: { ...expectedReceipt(pass), artifactDigestSha256: ONE_HASH } },
      { ...expected(value), biometricReceipt: { ...expectedReceipt(pass), receiptId: "wrong-receipt" } },
    ];
    for (const mismatch of mismatches) {
      expect(await service().issue({ request: value, expected: mismatch })).toMatchObject({ reasonCode: "invalid_request" });
    }
    expect(await service().issue({ request: { ...value, rawBody: "forbidden" }, expected: expected(value) })).toMatchObject({ reasonCode: "invalid_request" });
  });
});

describe("idempotency, isolation, readiness, and redaction", () => {
  test("returns the cached lost response and detects idempotency conflict/request replay", async () => {
    const issuer = service();
    const pass = await receipt();
    const firstRequest = await request(pass);
    const first = await issuer.issue({ request: firstRequest, expected: expected(firstRequest) });
    expect(await issuer.issue({ request: firstRequest, expected: expected(firstRequest) })).toEqual(first);

    const conflict = await request(pass, "issue_success", { requestId: "issuance-request-conflict" });
    expect(await issuer.issue({ request: conflict, expected: expected(conflict) })).toMatchObject({ reasonCode: "idempotency_conflict" });
    const replay = await request(pass, "issue_success", { idempotencyKey: "issuance-idempotency-replay" });
    expect(await issuer.issue({ request: replay, expected: expected(replay) })).toMatchObject({ reasonCode: "request_replay" });
  });

  test("bounds retained idempotency records", async () => {
    const issuer = service(undefined, 1);
    const pass = await receipt();
    const first = await request(pass);
    expect((await issuer.issue({ request: first, expected: expected(first) })).kind).toBe("simulated_credential_ready_v0");
    const second = await request(pass, "issue_success", {
      requestId: "issuance-request-2",
      idempotencyKey: "issuance-idempotency-2",
    });
    expect(await issuer.issue({ request: second, expected: expected(second) })).toEqual({
      kind: "staging_issuance_error_v0",
      reasonCode: "service_not_ready",
    });
  });

  test("rejects production before reading receipt outcome or authentication", async () => {
    let reads = 0;
    const sentinel = new Proxy({}, { get(_target, property) {
      if (property === "biometricReceipt" || property === "outcome" || property === "authentication") reads += 1;
      throw new Error("sensitive getter read");
    } });
    const production = new SimulatedStagingIssuerV0({
      runtimeEnvironment: "production",
      gatewayTrustRoot: gatewaySigner.trustRoot,
      biometricReceiptTrustRoot: biometricSigner.trustRoot,
      credentialSigner: {
        environment: SIMULATION_ENVIRONMENT,
        audience: SIMULATED_STAGING_AUDIENCE_V0,
        keyId: credentialSigner.trustRoot.keyId,
        privateKey: credentialSigner.privateKey,
      },
      credentialTtlMs: 1,
      maxCacheEntries: 1,
      now: () => NOW,
    });
    await expect(production.issue({ request: sentinel, expected: sentinel as ExpectedStagingIssuanceRequestV0 })).rejects.toThrow("forbidden in production");
    expect(reads).toBe(0);
  });

  test("readiness fails closed for purpose-confused trust roots", () => {
    const unavailable = new SimulatedStagingIssuerV0({
      runtimeEnvironment: "staging",
      gatewayTrustRoot: biometricSigner.trustRoot,
      biometricReceiptTrustRoot: biometricSigner.trustRoot,
      credentialSigner: {
        environment: SIMULATION_ENVIRONMENT,
        audience: SIMULATED_STAGING_AUDIENCE_V0,
        keyId: credentialSigner.trustRoot.keyId,
        privateKey: credentialSigner.privateKey,
      },
      credentialTtlMs: 1,
      maxCacheEntries: 1,
      now: () => NOW,
    });
    expect(unavailable.readiness()).toEqual({ ready: false, reasonCode: "service_not_ready" });
  });

  test("audit output never contains request, receipt, credential, signature, or upstream error text", async () => {
    const events: IssuerAuditEventV0[] = [];
    const pass = await receipt();
    const value = await request(pass);
    const result = await service((event) => events.push(event)).issue({ request: value, expected: expected(value) });
    expect(result.kind).toBe("simulated_credential_ready_v0");
    expect(events).toEqual([{ event: "credential_created" }]);
    const serialized = JSON.stringify(events);
    for (const forbidden of [value.requestId, value.sessionId, value.accountId, pass.receiptId, pass.authentication.signatureBase64Url, value.authentication.signatureBase64Url, "credentialId", "upstream stack"] ) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("swallows free-text audit transport failures", async () => {
    const pass = await receipt();
    const value = await request(pass);
    const result = await service(() => { throw new Error("secret upstream audit failure"); }).issue({
      request: value,
      expected: expected(value),
    });
    expect(result.kind).toBe("simulated_credential_ready_v0");
    expect(JSON.stringify(result)).not.toContain("secret upstream audit failure");
  });
});
