import {
  BIOMETRIC_SCENARIO_OUTCOME_V0,
  BIOMETRIC_SCENARIO_REASON_V0,
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  BIOMETRIC_VERIFICATION_PORT_V0,
  base64UrlToBytes,
  bytesToArrayBuffer,
  bytesToBase64Url,
  canonicalizeJsonV0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATION_RECEIPT_V0,
  SimulationArtifactInProductionError,
  stagingSignaturePreimageV0,
  verifyBiometricSimulationRequestV0,
  type BiometricSimulationRequestV0,
  type HexSha256,
  type RuntimeEnvironment,
  type SimulationReceiptV0,
  type StagingAuthenticationV0,
  type StagingEd25519TrustRootV0,
} from "../../../packages/contracts/src";
import {
  BIOMETRIC_SIMULATION_ERROR_V0,
  SIMULATION_RECEIPT_READY_V0,
  type BiometricVerificationInvocationV0,
  type BiometricVerificationPortV0,
  type BiometricVerificationResultV0,
} from "../../../packages/biometric-verification-port/src";

export interface StagingEd25519SignerV0 {
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly audience: typeof BIOMETRIC_SIMULATOR_AUDIENCE_V0;
  readonly keyId: string;
  readonly privateKey: CryptoKey;
}

export interface SimulatorAuditEventV0 {
  readonly event: "request_rejected" | "receipt_created" | "idempotent_replay";
  readonly reasonCode?: string;
}

export interface SimulatedBiometricVerifierConfigV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly gatewayTrustRoot: StagingEd25519TrustRootV0;
  readonly receiptSigner: StagingEd25519SignerV0;
  readonly simulatorVersion: string;
  readonly receiptTtlMs: number;
  readonly maxCacheEntries: number;
  readonly allowedSyntheticFixtureIds: readonly string[];
  readonly now: () => Date;
  readonly audit?: (event: SimulatorAuditEventV0) => void;
}

interface CachedResult {
  readonly fingerprint: string;
  readonly requestId: string;
  readonly result: BiometricVerificationResultV0;
  readonly expiresAtMs: number;
}

const invalidRequest = (): BiometricVerificationResultV0 => ({
  kind: BIOMETRIC_SIMULATION_ERROR_V0,
  reasonCode: "invalid_request",
});

async function sha256Hex(value: string): Promise<HexSha256> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signerIsReady(signer: StagingEd25519SignerV0): boolean {
  return (
    signer.environment === SIMULATION_ENVIRONMENT &&
    signer.audience === BIOMETRIC_SIMULATOR_AUDIENCE_V0 &&
    signer.keyId.length > 0 &&
    signer.privateKey.type === "private" &&
    signer.privateKey.algorithm.name === "Ed25519" &&
    signer.privateKey.usages.includes("sign")
  );
}

function trustRootIsReady(trustRoot: StagingEd25519TrustRootV0): boolean {
  try {
    return (
      trustRoot.environment === SIMULATION_ENVIRONMENT &&
      trustRoot.audience === BIOMETRIC_SIMULATOR_AUDIENCE_V0 &&
      trustRoot.keyId.length > 0 &&
      base64UrlToBytes(trustRoot.publicKeyRawBase64Url).byteLength === 32
    );
  } catch {
    return false;
  }
}

function emitAudit(
  audit: SimulatedBiometricVerifierConfigV0["audit"],
  event: SimulatorAuditEventV0,
): void {
  try {
    audit?.(Object.freeze(event));
  } catch {
    // Audit transport failures never change a simulator result or expose their free-text error.
  }
}

async function signReceipt(
  receipt: SimulationReceiptV0,
  signer: StagingEd25519SignerV0,
): Promise<SimulationReceiptV0> {
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    signer.privateKey,
    bytesToArrayBuffer(stagingSignaturePreimageV0(receipt as unknown as Record<string, unknown>)),
  );
  return {
    ...receipt,
    authentication: {
      ...receipt.authentication,
      signatureBase64Url: bytesToBase64Url(new Uint8Array(signature)),
    },
  };
}

export class SimulatedBiometricVerifierV0 implements BiometricVerificationPortV0 {
  readonly #config: SimulatedBiometricVerifierConfigV0;
  readonly #byIdempotencyKey = new Map<string, CachedResult>();
  readonly #requestIds = new Map<string, string>();

  constructor(config: SimulatedBiometricVerifierConfigV0) {
    this.#config = config;
  }

  readiness(): Readonly<{ ready: boolean; reasonCode?: "service_not_ready" }> {
    const ready =
      this.#config.runtimeEnvironment === "staging" &&
      trustRootIsReady(this.#config.gatewayTrustRoot) &&
      signerIsReady(this.#config.receiptSigner) &&
      this.#config.receiptSigner.keyId !== this.#config.gatewayTrustRoot.keyId &&
      this.#config.simulatorVersion.length > 0 &&
      this.#config.allowedSyntheticFixtureIds.every(
        (fixtureId) => fixtureId.length > 0 && !fixtureId.includes("://"),
      ) &&
      new Set(this.#config.allowedSyntheticFixtureIds).size ===
        this.#config.allowedSyntheticFixtureIds.length &&
      Number.isSafeInteger(this.#config.receiptTtlMs) &&
      this.#config.receiptTtlMs > 0 &&
      Number.isSafeInteger(this.#config.maxCacheEntries) &&
      this.#config.maxCacheEntries > 0;
    return Object.freeze(ready ? { ready: true } : { ready: false, reasonCode: "service_not_ready" });
  }

  async verify(invocation: BiometricVerificationInvocationV0): Promise<BiometricVerificationResultV0> {
    // Production isolation must precede every request getter, including outcome/authentication sentinels.
    if (this.#config.runtimeEnvironment === "production") {
      throw new SimulationArtifactInProductionError();
    }
    if (!this.readiness().ready) return { kind: BIOMETRIC_SIMULATION_ERROR_V0, reasonCode: "service_not_ready" };

    try {
      const now = this.#config.now();
      const expected = { ...invocation.expected, runtimeEnvironment: "staging" as const, now: now.toISOString() };
      if (!(await verifyBiometricSimulationRequestV0(
        invocation.request,
        expected,
        invocation.capturePolicy,
        this.#config.gatewayTrustRoot,
      ))) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "invalid_request" });
        return invalidRequest();
      }

      const request = invocation.request as BiometricSimulationRequestV0;
      if (
        request.frameBundle.dataMode === "synthetic_fixture" &&
        (request.frameBundle.syntheticFixtureId === undefined ||
          !this.#config.allowedSyntheticFixtureIds.includes(request.frameBundle.syntheticFixtureId))
      ) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "invalid_request" });
        return invalidRequest();
      }
      const fingerprint = await sha256Hex(canonicalizeJsonV0(request));
      for (const [key, entry] of this.#byIdempotencyKey) {
        if (entry.expiresAtMs <= now.getTime()) {
          this.#byIdempotencyKey.delete(key);
          this.#requestIds.delete(entry.requestId);
        }
      }
      const cached = this.#byIdempotencyKey.get(request.idempotencyKey);
      if (cached) {
        if (cached.fingerprint !== fingerprint || cached.requestId !== request.requestId) {
          emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "idempotency_conflict" });
          return { kind: BIOMETRIC_SIMULATION_ERROR_V0, reasonCode: "idempotency_conflict" };
        }
        emitAudit(this.#config.audit, { event: "idempotent_replay" });
        return cached.result;
      }
      const knownIdempotencyKey = this.#requestIds.get(request.requestId);
      if (knownIdempotencyKey !== undefined && knownIdempotencyKey !== request.idempotencyKey) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "request_replay" });
        return { kind: BIOMETRIC_SIMULATION_ERROR_V0, reasonCode: "request_replay" };
      }
      if (this.#byIdempotencyKey.size >= this.#config.maxCacheEntries) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "service_not_ready" });
        return { kind: BIOMETRIC_SIMULATION_ERROR_V0, reasonCode: "service_not_ready" };
      }

      const issuedAt = now.toISOString();
      const expiresAt = new Date(
        Math.min(Date.parse(request.expiresAt), now.getTime() + this.#config.receiptTtlMs),
      ).toISOString();
      if (Date.parse(expiresAt) <= now.getTime()) return invalidRequest();
      const receiptId = `sim-receipt-${(await sha256Hex(`biometric-receipt-v0:${fingerprint}`)).slice(0, 32)}`;
      const unsigned: SimulationReceiptV0 = {
        kind: SIMULATION_RECEIPT_V0,
        version: BIOMETRIC_VERIFICATION_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
        receiptId,
        requestId: request.requestId,
        simulatorVersion: this.#config.simulatorVersion,
        scenario: request.scenario,
        sessionId: request.sessionId,
        nonceDigestSha256: request.nonceDigestSha256,
        idempotencyKey: request.idempotencyKey,
        accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
        capturePolicyId: request.capturePolicyId,
        artifactDigestSha256: request.frameBundle.artifactDigestSha256,
        outcome: BIOMETRIC_SCENARIO_OUTCOME_V0[request.scenario],
        reasonCode: BIOMETRIC_SCENARIO_REASON_V0[request.scenario],
        issuedAt,
        expiresAt,
        authentication: {
          scheme: "staging-ed25519",
          keyId: this.#config.receiptSigner.keyId,
          signatureBase64Url: "pending",
        } satisfies StagingAuthenticationV0,
      };
      const signedReceipt = await signReceipt(unsigned, this.#config.receiptSigner);
      const receipt = Object.freeze({
        ...signedReceipt,
        authentication: Object.freeze({ ...signedReceipt.authentication }),
      });
      const result: BiometricVerificationResultV0 = Object.freeze({
        kind: SIMULATION_RECEIPT_READY_V0,
        receipt,
      });
      this.#byIdempotencyKey.set(request.idempotencyKey, {
        fingerprint,
        requestId: request.requestId,
        result,
        expiresAtMs: Date.parse(expiresAt),
      });
      this.#requestIds.set(request.requestId, request.idempotencyKey);
      emitAudit(this.#config.audit, { event: "receipt_created" });
      return result;
    } catch {
      emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "invalid_request" });
      return invalidRequest();
    }
  }
}
