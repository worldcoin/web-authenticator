import {
  assertSimulationArtifactAllowed,
  base64UrlToBytes,
  BIOMETRIC_SIMULATION_REQUEST_V0,
  BIOMETRIC_SIMULATION_SCENARIOS_V0,
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  BIOMETRIC_VERIFICATION_PORT_V0,
  ENROLLMENT_SESSION_V2,
  isEnrollmentTransitionAllowedV2,
  isSimulationReceiptV0,
  ISSUANCE_SIMULATION_SCENARIOS_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  stagingSignaturePreimageV0,
  STAGING_ISSUANCE_PORT_V0,
  STAGING_ISSUANCE_SIMULATION_REQUEST_V0,
  STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
  validateFrameBundleV0,
  validateSimulationCapturePolicyV0,
  verifyBiometricSimulationRequestV0,
  verifySimulatedStagingCredentialV0,
  verifySimulationReceiptV0,
  verifyStagingIssuanceSimulationRequestV0,
  type BiometricSimulationRequestV0,
  type EnrollmentSessionStateV2,
  type EnrollmentSessionV2,
  type FrameBundleV0,
  type HexSha256,
  type SimulatedStagingCredentialV0,
  type SimulationCapturePolicyV0,
  type SimulationReceiptV0,
  type StagingIssuanceSimulationRequestV0,
} from "../../../packages/contracts/src";
import { SIMULATION_RECEIPT_READY_V0 } from "../../../packages/biometric-verification-port/src";
import { STAGING_ISSUANCE_ERROR_V0 } from "../../../packages/staging-issuance-port/src";
import { bytesForBodyLimit, OpaqueBrowserHandleCodecV0, randomNonce, randomOpaqueId, sha256Text, signStagingArtifactV0 } from "./crypto";
import { GatewayErrorV0 } from "./errors";
import { InMemorySessionRepositoryV0 } from "./repository";
import type {
  CreateSessionResultV0,
  GatewayStatusCodeV0,
  RequestContextV0,
  SessionGatewayConfigV0,
  SessionRepositoryV0,
  SessionStatusV0,
  StoredSessionV0,
  SubmitCaptureResultV0,
} from "./types";

const TERMINAL_STATES = new Set<EnrollmentSessionStateV2>([
  "simulated_reject",
  "simulated_issuance_reject",
  "simulated_credential_ready",
  "cancelled",
  "expired",
]);

const RETRYABLE_CODES = new Set<GatewayStatusCodeV0>([
  "simulation_retry",
  "simulation_unavailable",
  "issuance_unavailable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hexSha256(value: unknown): value is HexSha256 {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

interface BrowserAuthFieldsV0 {
  readonly sessionId: string;
  readonly browserHandle: string;
}

export class SessionGatewayV0 {
  private readonly repository: SessionRepositoryV0;
  private readonly handles: OpaqueBrowserHandleCodecV0;
  private readonly clock: { now(): Date };
  private readonly mutationInFlight = new Map<
    string,
    {
      readonly kind: "passkey" | "prepare" | "capture" | "retry" | "cancel";
      readonly digest: HexSha256;
      readonly result: Promise<SessionStatusV0>;
    }
  >();
  private readonly creationInFlight = new Map<
    string,
    {
      readonly bindingDigest: HexSha256;
      readonly result: Promise<CreateSessionResultV0>;
    }
  >();
  private readonly responseCache = new Map<
    string,
    {
      readonly digest: HexSha256;
      readonly expiresAt: string;
      readonly result: SubmitCaptureResultV0;
    }
  >();
  private activeOperations = 0;

  constructor(
    private readonly config: SessionGatewayConfigV0,
    repository: SessionRepositoryV0 = new InMemorySessionRepositoryV0(),
  ) {
    this.repository = repository;
    this.handles = new OpaqueBrowserHandleCodecV0(config.handleKey);
    this.clock = config.clock ?? { now: () => new Date() };
    if (
      !Number.isSafeInteger(config.sessionTtlMs) ||
      config.sessionTtlMs <= 0 ||
      !Number.isSafeInteger(config.maxRequestBodyBytes) ||
      config.maxRequestBodyBytes <= 0 ||
      !Number.isSafeInteger(config.maxConcurrentOperations) ||
      config.maxConcurrentOperations <= 0 ||
      !Number.isSafeInteger(config.simulatorTimeoutMs) ||
      config.simulatorTimeoutMs <= 0 ||
      validateSimulationCapturePolicyV0({
        ...config.capturePolicy,
        expiresAt: new Date(this.clock.now().getTime() + config.sessionTtlMs).toISOString(),
      }).length > 0
    ) {
      throw new GatewayErrorV0("invalid_request", 500);
    }
  }

  async createSession(body: unknown, context: RequestContextV0): Promise<CreateSessionResultV0> {
    this.assertAvailable();
    this.assertBody(body);
    if (
      !isRecord(body) ||
      !exactKeys(body, ["rpRequest", "accountId", "accountPublicMaterialDigestSha256", "idempotencyKey"]) ||
      !nonEmpty(body.accountId) ||
      !hexSha256(body.accountPublicMaterialDigestSha256) ||
      !nonEmpty(body.idempotencyKey)
    ) {
      throw new GatewayErrorV0("invalid_request", 400);
    }
    const now = this.now();
    let verified;
    try {
      verified = await this.config.rpRequestVerifier.verify(body.rpRequest, context, now);
    } catch {
      throw new GatewayErrorV0("unauthorized", 401);
    }
    if (verified === null) throw new GatewayErrorV0("unauthorized", 401);
    if (verified.origin !== context.origin || verified.rpId !== context.rpId) {
      throw new GatewayErrorV0("origin_forbidden", 403);
    }
    const accountId = body.accountId;
    const accountPublicMaterialDigestSha256 = body.accountPublicMaterialDigestSha256;
    const idempotencyKey = body.idempotencyKey;

    const prior = this.repository.findByCreationIdempotency(verified.rpId, idempotencyKey);
    if (prior !== undefined) {
      if (
        prior.origin !== verified.origin ||
        prior.returnTarget !== verified.returnTarget ||
        prior.session.rpRequestDigestSha256 !== verified.requestDigestSha256 ||
        prior.accountId !== accountId ||
        prior.session.accountPublicMaterialDigestSha256 !== accountPublicMaterialDigestSha256
      ) {
        throw new GatewayErrorV0("binding_mismatch", 409);
      }
      this.expireIfNeeded(prior);
      return this.createResult(prior);
    }
    const creationKey = `${verified.rpId}\u0000${idempotencyKey}`;
    const bindingDigest = await sha256Text(JSON.stringify({
      rpId: verified.rpId,
      origin: verified.origin,
      returnTarget: verified.returnTarget,
      rpRequestDigestSha256: verified.requestDigestSha256,
      accountId,
      accountPublicMaterialDigestSha256,
      idempotencyKey,
    }));
    const active = this.creationInFlight.get(creationKey);
    if (active !== undefined) {
      if (active.bindingDigest !== bindingDigest) {
        throw new GatewayErrorV0("binding_mismatch", 409);
      }
      return active.result;
    }
    const operation = Promise.resolve().then(async () => {
      let scenarios;
      try {
        scenarios = await this.config.scenarioSelector.select({
          verifiedRpRequest: verified,
          authenticatedServerContext: context.authenticatedServerContext,
        });
      } catch {
        throw new GatewayErrorV0("unauthorized", 401);
      }
      if (
        !BIOMETRIC_SIMULATION_SCENARIOS_V0.includes(scenarios.biometric) ||
        !ISSUANCE_SIMULATION_SCENARIOS_V0.includes(scenarios.issuance)
      ) {
        throw new GatewayErrorV0("invalid_request", 500);
      }
      const createdAt = now;
      const expiresAt = new Date(Date.parse(now) + this.config.sessionTtlMs).toISOString();
      const session: EnrollmentSessionV2 = Object.freeze({
        version: ENROLLMENT_SESSION_V2,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        sessionId: randomOpaqueId("ses"),
        rpRequestDigestSha256: verified.requestDigestSha256,
        accountPublicMaterialDigestSha256,
        nonceBase64Url: randomNonce(),
        idempotencyKey,
        biometricScenario: scenarios.biometric,
        issuanceScenario: scenarios.issuance,
        state: "created",
        createdAt,
        expiresAt,
      });
      const record: StoredSessionV0 = {
        session,
        rpId: verified.rpId,
        origin: verified.origin,
        returnTarget: verified.returnTarget,
        accountId,
        nonceConsumed: false,
        captureAttempt: 0,
        statusCode: "created",
        operationResults: new Map(),
        operationRequestDigests: new Map(),
      };
      this.repository.put(record);
      this.audit(record, "session_created");
      return this.createResult(record);
    });
    this.creationInFlight.set(creationKey, { bindingDigest, result: operation });
    try {
      return await operation;
    } finally {
      this.creationInFlight.delete(creationKey);
    }
  }

  async completePasskey(body: unknown, context: RequestContextV0): Promise<SessionStatusV0> {
    this.assertAvailable();
    this.assertBody(body);
    if (
      !isRecord(body) ||
      !exactKeys(body, ["sessionId", "browserHandle", "idempotencyKey", "ceremony"]) ||
      !nonEmpty(body.sessionId) ||
      !nonEmpty(body.browserHandle) ||
      !nonEmpty(body.idempotencyKey)
    ) {
      throw new GatewayErrorV0("invalid_request", 400);
    }
    const record = await this.authenticate(body as unknown as BrowserAuthFieldsV0, context);
    const resultKey = `passkey:${body.idempotencyKey}`;
    const requestDigest = await sha256Text(JSON.stringify(body));
    const prior = record.operationResults.get(resultKey);
    if (prior !== undefined) {
      if (record.operationRequestDigests.get(resultKey) !== requestDigest) {
        throw new GatewayErrorV0("binding_mismatch", 409);
      }
      return prior;
    }
    const boundDigest = record.operationRequestDigests.get(resultKey);
    if (boundDigest !== undefined && boundDigest !== requestDigest) {
      throw new GatewayErrorV0("binding_mismatch", 409);
    }
    return this.runSessionMutation(record, "passkey", requestDigest, async () => {
      if (record.session.state !== "created") {
        throw new GatewayErrorV0("invalid_state", 409);
      }
      let valid = false;
      try {
        valid = await this.config.ceremonyVerifier.verify(body.ceremony, {
          sessionId: record.session.sessionId,
          rpId: record.rpId,
          origin: record.origin,
          accountPublicMaterialDigestSha256: record.session.accountPublicMaterialDigestSha256,
          now: this.now(),
        });
      } catch {
        valid = false;
      }
      if (!valid) throw new GatewayErrorV0("unauthorized", 401);
      record.operationRequestDigests.set(resultKey, requestDigest);
      this.transition(record, "passkey_complete", "passkey_complete");
      const result = this.status(record);
      record.operationResults.set(resultKey, result);
      this.audit(record, "passkey_complete");
      return result;
    });
  }

  async prepareCapture(body: unknown, context: RequestContextV0): Promise<CreateSessionResultV0> {
    this.assertAvailable();
    this.assertBody(body);
    const fields = this.parseAuthOnly(body);
    const record = await this.authenticate(fields, context);
    const requestDigest = await sha256Text(JSON.stringify(body));
    return this.runSessionMutation(record, "prepare", requestDigest, async () => {
      if (record.session.state !== "passkey_complete" && record.session.state !== "simulated_retry") {
        throw new GatewayErrorV0("invalid_state", 409);
      }
      if (record.session.state === "simulated_retry") {
        record.session = Object.freeze({ ...record.session, nonceBase64Url: randomNonce() });
        record.nonceConsumed = false;
        record.frameBundle = undefined;
        record.artifactDigestSha256 = undefined;
        record.biometricRequestId = undefined;
        record.biometricIdempotencyKey = undefined;
        record.biometricRequestedAt = undefined;
        record.receiptId = undefined;
        record.issuanceRequestId = undefined;
        record.issuanceIdempotencyKey = undefined;
        record.issuanceRequestedAt = undefined;
      }
      record.captureAttempt += 1;
      this.transition(record, "capture_ready", "capture_ready");
      this.audit(record, "capture_ready");
      return this.createResult(record);
    });
  }

  async submitCapture(body: unknown, context: RequestContextV0): Promise<SubmitCaptureResultV0> {
    this.assertAvailable();
    this.assertBody(body);
    if (
      !isRecord(body) ||
      !exactKeys(body, ["sessionId", "browserHandle", "idempotencyKey", "nonceBase64Url", "frameBundle"]) ||
      !nonEmpty(body.sessionId) ||
      !nonEmpty(body.browserHandle) ||
      !nonEmpty(body.idempotencyKey) ||
      !nonEmpty(body.nonceBase64Url)
    ) {
      throw new GatewayErrorV0("invalid_request", 400);
    }
    const record = await this.authenticate(body as unknown as BrowserAuthFieldsV0, context);
    const resultKey = `capture:${body.idempotencyKey}`;
    const cacheKey = `${record.session.sessionId}:${resultKey}`;
    const requestDigest = await sha256Text(JSON.stringify(body));
    const cached = this.cachedResponse(cacheKey, requestDigest);
    if (cached !== undefined) return cached;
    const prior = record.operationResults.get(resultKey);
    if (prior !== undefined) {
      if (record.operationRequestDigests.get(resultKey) !== requestDigest) {
        throw new GatewayErrorV0("binding_mismatch", 409);
      }
      return prior;
    }
    const boundCaptureDigest = record.operationRequestDigests.get(resultKey);
    if (boundCaptureDigest !== undefined && boundCaptureDigest !== requestDigest) {
      throw new GatewayErrorV0("binding_mismatch", 409);
    }
    return this.runSessionMutation(record, "capture", requestDigest, () => this.withOperation(async () => {
      if (record.nonceConsumed || body.nonceBase64Url !== record.session.nonceBase64Url) {
        throw new GatewayErrorV0("replay_rejected", 409);
      }
      if (record.session.state !== "capture_ready") {
        throw new GatewayErrorV0("invalid_state", 409);
      }
      record.operationRequestDigests.set(resultKey, requestDigest);
      const frameBundle = body.frameBundle;
      const policy = this.policyFor(record);
      const validationErrors = await validateFrameBundleV0(frameBundle, policy);
      if (
        validationErrors.length > 0 ||
        !isRecord(frameBundle) ||
        frameBundle.sessionId !== record.session.sessionId ||
        frameBundle.accountPublicMaterialDigestSha256 !== record.session.accountPublicMaterialDigestSha256 ||
        frameBundle.nonceDigestSha256 !== (await sha256Text(record.session.nonceBase64Url)) ||
        (frameBundle.dataMode === "synthetic_fixture" &&
          (!nonEmpty(frameBundle.syntheticFixtureId) ||
            !this.config.allowedSyntheticFixtureIds.includes(frameBundle.syntheticFixtureId)))
      ) {
        throw new GatewayErrorV0("artifact_invalid", 400);
      }
      record.nonceConsumed = true;
      record.frameBundle = frameBundle as unknown as FrameBundleV0;
      record.artifactDigestSha256 = record.frameBundle.artifactDigestSha256;
      this.transition(record, "biometric_simulation_pending", "capture_ready");
      const result = await this.orchestrate(record);
      record.operationResults.set(resultKey, this.status(record));
      return this.cacheResponse(cacheKey, requestDigest, record.session.expiresAt, result);
    }));
  }

  async retryUnavailable(body: unknown, context: RequestContextV0): Promise<SubmitCaptureResultV0> {
    this.assertAvailable();
    this.assertBody(body);
    if (
      !isRecord(body) ||
      !exactKeys(body, ["sessionId", "browserHandle", "idempotencyKey"]) ||
      !nonEmpty(body.sessionId) ||
      !nonEmpty(body.browserHandle) ||
      !nonEmpty(body.idempotencyKey)
    ) {
      throw new GatewayErrorV0("invalid_request", 400);
    }
    const record = await this.authenticate(body as unknown as BrowserAuthFieldsV0, context);
    const resultKey = `retry:${body.idempotencyKey}`;
    const cacheKey = `${record.session.sessionId}:${resultKey}`;
    const requestDigest = await sha256Text(JSON.stringify(body));
    const cached = this.cachedResponse(cacheKey, requestDigest);
    if (cached !== undefined) return cached;
    const prior = record.operationResults.get(resultKey);
    if (prior !== undefined) {
      if (record.operationRequestDigests.get(resultKey) !== requestDigest) {
        throw new GatewayErrorV0("binding_mismatch", 409);
      }
      return prior;
    }
    const boundRetryDigest = record.operationRequestDigests.get(resultKey);
    if (boundRetryDigest !== undefined && boundRetryDigest !== requestDigest) {
      throw new GatewayErrorV0("binding_mismatch", 409);
    }
    return this.runSessionMutation(record, "retry", requestDigest, () => this.withOperation(async () => {
      if (
        (record.session.state !== "simulated_unavailable" &&
          record.session.state !== "simulated_issuance_unavailable") ||
        record.frameBundle === undefined
      ) {
        throw new GatewayErrorV0("invalid_state", 409);
      }
      record.operationRequestDigests.set(resultKey, requestDigest);
      let retryResult: SubmitCaptureResultV0;
      if (record.session.state === "simulated_unavailable") {
        this.transition(record, "biometric_simulation_pending", "simulation_unavailable");
        retryResult = await this.orchestrate(record);
      } else {
        const receipt = await this.runBiometric(record, record.frameBundle!);
        if (receipt === null || receipt.outcome !== "simulated_pass") {
          retryResult = this.status(record);
        } else {
          this.transition(record, "issuance_simulation_pending", "issuance_unavailable");
          retryResult = await this.runIssuance(
            record,
            receipt as SimulationReceiptV0 & { readonly outcome: "simulated_pass" },
          );
        }
      }
      record.operationResults.set(resultKey, this.status(record));
      return this.cacheResponse(
        cacheKey,
        requestDigest,
        record.session.expiresAt,
        retryResult,
      );
    }));
  }

  async cancel(body: unknown, context: RequestContextV0): Promise<SessionStatusV0> {
    this.assertAvailable();
    this.assertBody(body);
    const fields = this.parseAuthOnly(body);
    const record = await this.authenticate(fields, context);
    const requestDigest = await sha256Text(JSON.stringify(body));
    return this.runSessionMutation(record, "cancel", requestDigest, async () => {
      if (TERMINAL_STATES.has(record.session.state)) return this.status(record);
      this.transition(record, "cancelled", "cancelled");
      record.frameBundle = undefined;
      this.audit(record, "session_cancelled");
      return this.status(record);
    });
  }

  async getStatus(body: unknown, context: RequestContextV0): Promise<SessionStatusV0> {
    this.assertAvailable();
    this.assertBody(body);
    return this.status(await this.authenticate(this.parseAuthOnly(body), context));
  }

  async readiness(): Promise<{ readonly ready: boolean; readonly code: "ready" | "disabled" | "dependency_unavailable" }> {
    if (!this.isAvailable()) return { ready: false, code: "disabled" };
    if (!this.purposeKeyMaterialsAreDistinct()) {
      return { ready: false, code: "dependency_unavailable" };
    }
    const [biometric, issuance] = await Promise.all([
      this.safeReady(() => this.config.biometricClient.readiness().ready),
      this.safeReady(() => this.config.issuanceClient.readiness().ready),
    ]);
    return biometric && issuance
      ? { ready: true, code: "ready" }
      : { ready: false, code: "dependency_unavailable" };
  }

  purgeExpired(): number {
    const nowMs = this.clock.now().getTime();
    this.purgeResponseCache(nowMs);
    return this.repository.purgeExpired(nowMs);
  }

  private async orchestrate(record: StoredSessionV0): Promise<SubmitCaptureResultV0> {
    const frameBundle = record.frameBundle;
    if (frameBundle === undefined) throw new GatewayErrorV0("invalid_state", 409);
    const receipt = await this.runBiometric(record, frameBundle);
    if (receipt === null) {
      if (this.expireDuringOperation(record)) return this.status(record);
      return this.unavailable(record, "simulation_unavailable");
    }
    this.audit(record, "simulation_finished", this.codeForOutcome(receipt.outcome));
    if (receipt.outcome === "simulated_reject") {
      this.transition(record, "simulated_reject", "simulation_reject");
      record.frameBundle = undefined;
      return this.status(record);
    }
    if (receipt.outcome === "simulated_retry") {
      this.transition(record, "simulated_retry", "simulation_retry");
      record.frameBundle = undefined;
      return this.status(record);
    }
    if (receipt.outcome === "simulated_unavailable") {
      return this.unavailable(record, "simulation_unavailable");
    }
    this.transition(record, "simulated_pass", "simulation_pass");
    this.transition(record, "issuance_simulation_pending", "simulation_pass");
    return this.runIssuance(
      record,
      receipt as SimulationReceiptV0 & { readonly outcome: "simulated_pass" },
    );
  }

  private async runBiometric(record: StoredSessionV0, frameBundle: FrameBundleV0): Promise<SimulationReceiptV0 | null> {
    const verificationNow = this.now();
    const nonceDigestSha256 = await sha256Text(record.session.nonceBase64Url);
    record.biometricRequestId ??= randomOpaqueId("bio_req");
    record.biometricIdempotencyKey ??= `bio-${record.session.sessionId}-${record.captureAttempt}`;
    record.biometricRequestedAt ??= verificationNow;
    const pending: BiometricSimulationRequestV0 = {
      kind: BIOMETRIC_SIMULATION_REQUEST_V0,
      version: BIOMETRIC_VERIFICATION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
      requestId: record.biometricRequestId,
      sessionId: record.session.sessionId,
      nonceDigestSha256,
      idempotencyKey: record.biometricIdempotencyKey,
      accountPublicMaterialDigestSha256: record.session.accountPublicMaterialDigestSha256,
      capturePolicyId: this.config.capturePolicy.policyId,
      scenario: record.session.biometricScenario,
      frameBundle,
      requestedAt: record.biometricRequestedAt,
      expiresAt: record.session.expiresAt,
      authentication: { scheme: "staging-ed25519", keyId: "pending", signatureBase64Url: "pending" },
    };
    let request: BiometricSimulationRequestV0;
    try {
      request = await signStagingArtifactV0(pending, this.config.biometricRequestSigner, stagingSignaturePreimageV0);
    } catch {
      return null;
    }
    const expectedRequest = {
      runtimeEnvironment: this.config.runtimeEnvironment,
      requestId: request.requestId,
      sessionId: request.sessionId,
      nonceDigestSha256: request.nonceDigestSha256,
      idempotencyKey: request.idempotencyKey,
      accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
      capturePolicyId: request.capturePolicyId,
      scenario: request.scenario,
      now: verificationNow,
    } as const;
    if (!(await verifyBiometricSimulationRequestV0(request, expectedRequest, this.policyFor(record), this.config.biometricRequestSigner.trustRoot))) {
      return null;
    }
    let response: unknown;
    try {
      response = await this.withTimeout(this.config.biometricClient.verify({
        request,
        expected: expectedRequest,
        capturePolicy: this.policyFor(record),
      }));
    } catch {
      return null;
    }
    try {
      assertSimulationArtifactAllowed(this.config.runtimeEnvironment, response);
      if (
        !isRecord(response) ||
        !exactKeys(response, ["kind", "receipt"]) ||
        response.kind !== SIMULATION_RECEIPT_READY_V0 ||
        !isSimulationReceiptV0(response.receipt)
      ) {
        return null;
      }
      const receipt = response.receipt;
      if (
        Date.parse(receipt.issuedAt) < Date.parse(request.requestedAt) ||
        Date.parse(receipt.expiresAt) > Date.parse(record.session.expiresAt)
      ) {
        return null;
      }
      const valid = await verifySimulationReceiptV0(receipt, {
        ...expectedRequest,
        receiptId: receipt.receiptId,
        artifactDigestSha256: frameBundle.artifactDigestSha256,
        now: this.now(),
      }, this.config.biometricReceiptTrustRoot);
      if (!valid) return null;
      record.receiptId = receipt.receiptId;
      return receipt;
    } catch {
      return null;
    }
  }

  private async runIssuance(record: StoredSessionV0, receipt: SimulationReceiptV0 & { outcome: "simulated_pass" }): Promise<SubmitCaptureResultV0> {
    if (this.expireDuringOperation(record)) return this.status(record);
    const verificationNow = this.now();
    record.issuanceRequestId ??= randomOpaqueId("iss_req");
    record.issuanceIdempotencyKey ??= `iss-${record.session.sessionId}-${record.captureAttempt}`;
    record.issuanceRequestedAt ??= verificationNow;
    const pending: StagingIssuanceSimulationRequestV0 = {
      kind: STAGING_ISSUANCE_SIMULATION_REQUEST_V0,
      version: STAGING_ISSUANCE_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      audience: STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
      requestId: record.issuanceRequestId,
      sessionId: record.session.sessionId,
      nonceDigestSha256: receipt.nonceDigestSha256,
      idempotencyKey: record.issuanceIdempotencyKey,
      accountId: record.accountId,
      accountPublicMaterialDigestSha256: record.session.accountPublicMaterialDigestSha256,
      biometricReceipt: receipt,
      scenario: record.session.issuanceScenario,
      requestedAt: record.issuanceRequestedAt,
      expiresAt: record.session.expiresAt,
      authentication: { scheme: "staging-ed25519", keyId: "pending", signatureBase64Url: "pending" },
    };
    let request: StagingIssuanceSimulationRequestV0;
    try {
      request = await signStagingArtifactV0(pending, this.config.issuanceRequestSigner, stagingSignaturePreimageV0);
    } catch {
      return this.issuanceUnavailable(record);
    }
    const expectedReceipt = {
      runtimeEnvironment: this.config.runtimeEnvironment,
      receiptId: receipt.receiptId,
      requestId: receipt.requestId,
      sessionId: receipt.sessionId,
      nonceDigestSha256: receipt.nonceDigestSha256,
      idempotencyKey: receipt.idempotencyKey,
      accountPublicMaterialDigestSha256: receipt.accountPublicMaterialDigestSha256,
      capturePolicyId: receipt.capturePolicyId,
      scenario: receipt.scenario,
      artifactDigestSha256: receipt.artifactDigestSha256,
      now: verificationNow,
    } as const;
    const expectedRequest = {
      runtimeEnvironment: this.config.runtimeEnvironment,
      requestId: request.requestId,
      sessionId: request.sessionId,
      nonceDigestSha256: request.nonceDigestSha256,
      idempotencyKey: request.idempotencyKey,
      accountId: request.accountId,
      accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
      biometricReceipt: expectedReceipt,
      scenario: request.scenario,
      now: verificationNow,
    } as const;
    if (!(await verifyStagingIssuanceSimulationRequestV0(request, expectedRequest, this.config.issuanceRequestSigner.trustRoot, this.config.biometricReceiptTrustRoot))) {
      return this.issuanceUnavailable(record);
    }
    let response: unknown;
    try {
      response = await this.withTimeout(this.config.issuanceClient.issue({
        request,
        expected: expectedRequest,
      }));
    } catch {
      return this.issuanceUnavailable(record);
    }
    if (this.expireDuringOperation(record)) return this.status(record);
    try {
      assertSimulationArtifactAllowed(this.config.runtimeEnvironment, response);
      if (!isRecord(response) || !nonEmpty(response.kind)) {
        return this.issuanceUnavailable(record);
      }
      if (response.kind === STAGING_ISSUANCE_ERROR_V0) {
        return this.issuanceUnavailable(record);
      }
      const expectedKind = record.session.issuanceScenario === "issue_success"
        ? "simulated_credential_ready_v0"
        : record.session.issuanceScenario === "issue_reject"
          ? "simulated_issuance_rejected_v0"
          : "simulated_issuance_unavailable_v0";
      if (response.kind !== expectedKind) return this.issuanceUnavailable(record);
      if (response.kind === "simulated_issuance_rejected_v0") {
        if (
          !exactKeys(response, ["kind", "reasonCode"]) ||
          response.reasonCode !== "scenario_issue_reject"
        ) {
          return this.issuanceUnavailable(record);
        }
        this.transition(record, "simulated_issuance_reject", "issuance_rejected");
        record.frameBundle = undefined;
        this.audit(record, "issuance_finished", "issuance_rejected");
        return this.status(record);
      }
      if (response.kind === "simulated_issuance_unavailable_v0") {
        if (
          !exactKeys(response, ["kind", "reasonCode"]) ||
          response.reasonCode !== "scenario_issue_unavailable"
        ) {
          return this.issuanceUnavailable(record);
        }
        return this.issuanceUnavailable(record);
      }
      if (
        response.kind !== "simulated_credential_ready_v0" ||
        !exactKeys(response, ["kind", "credential"])
      ) {
        return this.issuanceUnavailable(record);
      }
      const credential = response.credential;
      if (
        !isRecord(credential) ||
        typeof credential.issuedAt !== "string" ||
        typeof credential.expiresAt !== "string" ||
        Date.parse(credential.issuedAt) < Date.parse(request.requestedAt) ||
        Date.parse(credential.expiresAt) > Date.parse(record.session.expiresAt)
      ) {
        return this.issuanceUnavailable(record);
      }
      const valid = await verifySimulatedStagingCredentialV0(credential, {
        runtimeEnvironment: this.config.runtimeEnvironment,
        issuanceRequestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        nonceDigestSha256: request.nonceDigestSha256,
        subjectAccountId: record.accountId,
        accountPublicMaterialDigestSha256: record.session.accountPublicMaterialDigestSha256,
        simulationReceiptId: receipt.receiptId,
        now: this.now(),
      }, this.config.simulatedCredentialTrustRoot);
      if (!valid) return this.issuanceUnavailable(record);
      this.transition(record, "simulated_credential_ready", "simulated_credential_ready");
      record.frameBundle = undefined;
      this.audit(record, "issuance_finished", "simulated_credential_ready");
      return {
        ...this.status(record),
        credential: credential as unknown as SimulatedStagingCredentialV0,
      };
    } catch {
      return this.issuanceUnavailable(record);
    }
  }

  private unavailable(record: StoredSessionV0, code: "simulation_unavailable"): SubmitCaptureResultV0 {
    this.transition(record, "simulated_unavailable", code);
    this.audit(record, "simulation_finished", code);
    return this.status(record);
  }

  private issuanceUnavailable(record: StoredSessionV0): SubmitCaptureResultV0 {
    this.transition(record, "simulated_issuance_unavailable", "issuance_unavailable");
    this.audit(record, "issuance_finished", "issuance_unavailable");
    return this.status(record);
  }

  private expireDuringOperation(record: StoredSessionV0): boolean {
    if (Date.parse(record.session.expiresAt) > this.clock.now().getTime()) return false;
    this.transition(record, "expired", "expired");
    record.frameBundle = undefined;
    this.purgeSessionResponses(record.session.sessionId);
    this.audit(record, "session_expired");
    return true;
  }

  private parseAuthOnly(body: unknown): BrowserAuthFieldsV0 {
    if (
      !isRecord(body) ||
      !exactKeys(body, ["sessionId", "browserHandle"]) ||
      !nonEmpty(body.sessionId) ||
      !nonEmpty(body.browserHandle)
    ) {
      throw new GatewayErrorV0("invalid_request", 400);
    }
    return body as unknown as BrowserAuthFieldsV0;
  }

  private async authenticate(fields: BrowserAuthFieldsV0, context: RequestContextV0): Promise<StoredSessionV0> {
    const record = this.repository.get(fields.sessionId);
    if (record === undefined) throw new GatewayErrorV0("not_found", 404);
    if (context.origin !== record.origin || context.rpId !== record.rpId) {
      throw new GatewayErrorV0("origin_forbidden", 403);
    }
    const payload = await this.handles.open(fields.browserHandle);
    if (
      payload === null ||
      payload.sessionId !== record.session.sessionId ||
      payload.origin !== record.origin ||
      payload.rpId !== record.rpId ||
      payload.expiresAt !== record.session.expiresAt
    ) {
      throw new GatewayErrorV0("unauthorized", 401);
    }
    this.expireIfNeeded(record);
    return record;
  }

  private expireIfNeeded(record: StoredSessionV0): void {
    if (Date.parse(record.session.expiresAt) > this.clock.now().getTime()) return;
    if (!TERMINAL_STATES.has(record.session.state)) {
      this.transition(record, "expired", "expired");
      record.frameBundle = undefined;
      this.audit(record, "session_expired");
    }
    this.purgeSessionResponses(record.session.sessionId);
    throw new GatewayErrorV0("expired", 410);
  }

  private transition(record: StoredSessionV0, next: EnrollmentSessionStateV2, code: GatewayStatusCodeV0): void {
    if (!isEnrollmentTransitionAllowedV2(record.session.state, next)) {
      throw new GatewayErrorV0("invalid_state", 409);
    }
    record.session = Object.freeze({ ...record.session, state: next });
    record.statusCode = code;
  }

  private status(record: StoredSessionV0): SessionStatusV0 {
    return Object.freeze({
      session: record.session,
      code: record.statusCode,
      retryable: RETRYABLE_CODES.has(record.statusCode),
    });
  }

  private runSessionMutation<T extends SessionStatusV0>(
    record: StoredSessionV0,
    kind: "passkey" | "prepare" | "capture" | "retry" | "cancel",
    requestDigest: HexSha256,
    operation: () => Promise<T>,
  ): Promise<T> {
    const sessionId = record.session.sessionId;
    const active = this.mutationInFlight.get(sessionId);
    if (active !== undefined) {
      if (active.kind !== kind || active.digest !== requestDigest) {
        throw new GatewayErrorV0("binding_mismatch", 409);
      }
      return active.result as Promise<T>;
    }
    const result = Promise.resolve().then(operation);
    this.mutationInFlight.set(sessionId, {
      kind,
      digest: requestDigest,
      result,
    });
    return result.finally(() => {
      if (this.mutationInFlight.get(sessionId)?.result === result) {
        this.mutationInFlight.delete(sessionId);
      }
    });
  }

  private cachedResponse(
    cacheKey: string,
    requestDigest: HexSha256,
  ): SubmitCaptureResultV0 | undefined {
    const cached = this.responseCache.get(cacheKey);
    if (cached === undefined) return undefined;
    if (Date.parse(cached.expiresAt) <= this.clock.now().getTime()) {
      this.responseCache.delete(cacheKey);
      return undefined;
    }
    if (cached.digest !== requestDigest) {
      throw new GatewayErrorV0("binding_mismatch", 409);
    }
    return cached.result;
  }

  private cacheResponse(
    cacheKey: string,
    requestDigest: HexSha256,
    expiresAt: string,
    result: SubmitCaptureResultV0,
  ): SubmitCaptureResultV0 {
    const immutableResult = result.credential === undefined
      ? Object.freeze({ ...result })
      : Object.freeze({
          ...result,
          credential: Object.freeze({
            ...result.credential,
            claims: Object.freeze({ ...result.credential.claims }),
            authentication: Object.freeze({ ...result.credential.authentication }),
          }),
        });
    if (Date.parse(expiresAt) > this.clock.now().getTime()) {
      this.responseCache.set(cacheKey, {
        digest: requestDigest,
        expiresAt,
        result: immutableResult,
      });
    }
    return immutableResult;
  }

  private purgeResponseCache(nowMs: number): void {
    for (const [cacheKey, cached] of this.responseCache) {
      if (Date.parse(cached.expiresAt) <= nowMs) this.responseCache.delete(cacheKey);
    }
  }

  private purgeSessionResponses(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const cacheKey of this.responseCache.keys()) {
      if (cacheKey.startsWith(prefix)) this.responseCache.delete(cacheKey);
    }
  }

  private async createResult(record: StoredSessionV0): Promise<CreateSessionResultV0> {
    const browserHandle = await this.handles.seal({
      sessionId: record.session.sessionId,
      rpId: record.rpId,
      origin: record.origin,
      expiresAt: record.session.expiresAt,
    });
    return Object.freeze({
      ...this.status(record),
      browserHandle,
      capturePolicy: this.policyFor(record),
    });
  }

  private policyFor(record: StoredSessionV0): SimulationCapturePolicyV0 {
    return Object.freeze({ ...this.config.capturePolicy, expiresAt: record.session.expiresAt });
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) throw new GatewayErrorV0("gateway_disabled", 404);
  }

  private isAvailable(): boolean {
    return this.config.enabled && this.config.runtimeEnvironment === "staging";
  }

  private assertBody(body: unknown): void {
    if (bytesForBodyLimit(body) > this.config.maxRequestBodyBytes) {
      throw new GatewayErrorV0("body_too_large", 413);
    }
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  private async withOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperations >= this.config.maxConcurrentOperations) {
      throw new GatewayErrorV0("resource_busy", 429);
    }
    this.activeOperations += 1;
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
    }
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new GatewayErrorV0("resource_busy", 503)), this.config.simulatorTimeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async safeReady(check: () => boolean | Promise<boolean>): Promise<boolean> {
    try {
      return await this.withTimeout(Promise.resolve(check()));
    } catch {
      return false;
    }
  }

  private purposeKeyMaterialsAreDistinct(): boolean {
    try {
      const fingerprints = [
        this.config.biometricRequestSigner.trustRoot,
        this.config.biometricReceiptTrustRoot,
        this.config.issuanceRequestSigner.trustRoot,
        this.config.simulatedCredentialTrustRoot,
      ].map((trustRoot) => {
        const bytes = base64UrlToBytes(trustRoot.publicKeyRawBase64Url);
        if (bytes.byteLength !== 32) throw new TypeError("invalid_staging_public_key");
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      });
      return new Set(fingerprints).size === fingerprints.length;
    } catch {
      return false;
    }
  }

  private codeForOutcome(outcome: SimulationReceiptV0["outcome"]): GatewayStatusCodeV0 {
    return outcome === "simulated_pass"
      ? "simulation_pass"
      : outcome === "simulated_reject"
        ? "simulation_reject"
        : outcome === "simulated_retry"
          ? "simulation_retry"
          : "simulation_unavailable";
  }

  private audit(record: StoredSessionV0, event: Parameters<NonNullable<SessionGatewayConfigV0["auditSink"]>["record"]>[0]["event"], code?: GatewayStatusCodeV0): void {
    try {
      this.config.auditSink?.record(Object.freeze({
        event,
        sessionId: record.session.sessionId,
        state: record.session.state,
        ...(code === undefined ? {} : { code }),
      }));
    } catch {
      // Audit transport failures cannot alter the authoritative session outcome.
    }
  }
}

export function rejectSimulationArtifactAtProductionBoundary(runtimeEnvironment: "development" | "test" | "staging" | "production", artifact: unknown): void {
  assertSimulationArtifactAllowed(runtimeEnvironment, artifact);
}
