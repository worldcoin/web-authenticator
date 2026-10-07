import {
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  base64UrlToBytes,
  bytesToArrayBuffer,
  bytesToBase64Url,
  canonicalizeJsonV0,
  SIMULATED_STAGING_AUDIENCE_V0,
  SIMULATED_STAGING_CREDENTIAL_V0,
  SIMULATED_STAGING_ISSUER_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SimulationArtifactInProductionError,
  stagingSignaturePreimageV0,
  STAGING_ISSUANCE_PORT_V0,
  STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
  verifySimulationReceiptV0,
  verifyStagingIssuanceSimulationRequestV0,
  verifyStagingEd25519V0,
  isRecord,
  type HexSha256,
  type RuntimeEnvironment,
  type SimulatedStagingCredentialV0,
  type StagingAuthenticationV0,
  type StagingEd25519TrustRootV0,
  type StagingIssuanceSimulationRequestV0,
} from "../../../packages/contracts/src";
import {
  STAGING_ISSUANCE_ERROR_V0,
  type StagingIssuanceInvocationV0,
  type StagingIssuancePortResultV0,
  type StagingIssuancePortV0,
} from "../../../packages/staging-issuance-port/src";

export interface StagingCredentialSignerV0 {
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly audience: typeof SIMULATED_STAGING_AUDIENCE_V0;
  readonly keyId: string;
  readonly privateKey: CryptoKey;
}

export interface IssuerAuditEventV0 {
  readonly event: "request_rejected" | "credential_created" | "scenario_result" | "idempotent_replay";
  readonly reasonCode?: string;
}

export interface SimulatedStagingIssuerConfigV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly gatewayTrustRoot: StagingEd25519TrustRootV0;
  readonly biometricReceiptTrustRoot: StagingEd25519TrustRootV0;
  readonly credentialSigner: StagingCredentialSignerV0;
  readonly credentialTtlMs: number;
  readonly maxCacheEntries: number;
  readonly now: () => Date;
  readonly audit?: (event: IssuerAuditEventV0) => void;
}

interface CachedResult {
  readonly fingerprint: string;
  readonly requestId: string;
  readonly result: StagingIssuancePortResultV0;
  readonly expiresAtMs: number;
}

async function sha256Hex(value: string): Promise<HexSha256> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signerIsReady(signer: StagingCredentialSignerV0): boolean {
  return (
    signer.environment === SIMULATION_ENVIRONMENT &&
    signer.audience === SIMULATED_STAGING_AUDIENCE_V0 &&
    signer.keyId.length > 0 &&
    signer.privateKey.type === "private" &&
    signer.privateKey.algorithm.name === "Ed25519" &&
    signer.privateKey.usages.includes("sign")
  );
}

function trustRootIsReady(
  trustRoot: StagingEd25519TrustRootV0,
  audience: string,
): boolean {
  try {
    return (
      trustRoot.environment === SIMULATION_ENVIRONMENT &&
      trustRoot.audience === audience &&
      trustRoot.keyId.length > 0 &&
      base64UrlToBytes(trustRoot.publicKeyRawBase64Url).byteLength === 32
    );
  } catch {
    return false;
  }
}

function emitAudit(
  audit: SimulatedStagingIssuerConfigV0["audit"],
  event: IssuerAuditEventV0,
): void {
  try {
    audit?.(Object.freeze(event));
  } catch {
    // Audit transport failures never change a simulator result or expose their free-text error.
  }
}

async function signCredential(
  credential: SimulatedStagingCredentialV0,
  signer: StagingCredentialSignerV0,
): Promise<SimulatedStagingCredentialV0> {
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    signer.privateKey,
    bytesToArrayBuffer(stagingSignaturePreimageV0(credential as unknown as Record<string, unknown>)),
  );
  return {
    ...credential,
    authentication: {
      ...credential.authentication,
      signatureBase64Url: bytesToBase64Url(new Uint8Array(signature)),
    },
  };
}

export class SimulatedStagingIssuerV0 implements StagingIssuancePortV0 {
  readonly #config: SimulatedStagingIssuerConfigV0;
  readonly #byIdempotencyKey = new Map<string, CachedResult>();
  readonly #requestIds = new Map<string, string>();

  constructor(config: SimulatedStagingIssuerConfigV0) {
    this.#config = config;
  }

  readiness(): Readonly<{ ready: boolean; reasonCode?: "service_not_ready" }> {
    const ready =
      this.#config.runtimeEnvironment === "staging" &&
      trustRootIsReady(
        this.#config.gatewayTrustRoot,
        STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
      ) &&
      trustRootIsReady(
        this.#config.biometricReceiptTrustRoot,
        BIOMETRIC_SIMULATOR_AUDIENCE_V0,
      ) &&
      signerIsReady(this.#config.credentialSigner) &&
      new Set([
        this.#config.gatewayTrustRoot.keyId,
        this.#config.biometricReceiptTrustRoot.keyId,
        this.#config.credentialSigner.keyId,
      ]).size === 3 &&
      Number.isSafeInteger(this.#config.credentialTtlMs) &&
      this.#config.credentialTtlMs > 0 &&
      Number.isSafeInteger(this.#config.maxCacheEntries) &&
      this.#config.maxCacheEntries > 0;
    return Object.freeze(ready ? { ready: true } : { ready: false, reasonCode: "service_not_ready" });
  }

  async issue(invocation: StagingIssuanceInvocationV0): Promise<StagingIssuancePortResultV0> {
    // This branch intentionally executes before any property read from an untrusted request.
    if (this.#config.runtimeEnvironment === "production") {
      throw new SimulationArtifactInProductionError();
    }
    if (!this.readiness().ready) return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "service_not_ready" };

    try {
      if (
        !isRecord(invocation.request) ||
        !(await verifyStagingEd25519V0(invocation.request, this.#config.gatewayTrustRoot))
      ) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "invalid_request" });
        return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "invalid_request" };
      }
      const now = this.#config.now();
      const embeddedReceipt = invocation.request.biometricReceipt;
      const expectedBiometricReceipt = {
        ...invocation.expected.biometricReceipt,
        runtimeEnvironment: "staging" as const,
        now: now.toISOString(),
      };
      // Authenticate the nested artifact, its current time, and every expected binding before
      // classifying the outcome. An outer gateway signature cannot substitute for this check.
      if (
        !(await verifySimulationReceiptV0(
          embeddedReceipt,
          expectedBiometricReceipt,
          this.#config.biometricReceiptTrustRoot,
        ))
      ) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "invalid_request" });
        return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "invalid_request" };
      }
      if ((embeddedReceipt as { readonly outcome: unknown }).outcome !== "simulated_pass") {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "non_pass_receipt" });
        return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "non_pass_receipt" };
      }
      const expected = {
        ...invocation.expected,
        runtimeEnvironment: "staging" as const,
        biometricReceipt: expectedBiometricReceipt,
        now: now.toISOString(),
      };
      if (!(await verifyStagingIssuanceSimulationRequestV0(
        invocation.request,
        expected,
        this.#config.gatewayTrustRoot,
        this.#config.biometricReceiptTrustRoot,
      ))) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "invalid_request" });
        return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "invalid_request" };
      }

      const request = invocation.request as unknown as StagingIssuanceSimulationRequestV0;
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
          return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "idempotency_conflict" };
        }
        emitAudit(this.#config.audit, { event: "idempotent_replay" });
        return cached.result;
      }
      const knownIdempotencyKey = this.#requestIds.get(request.requestId);
      if (knownIdempotencyKey !== undefined && knownIdempotencyKey !== request.idempotencyKey) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "request_replay" });
        return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "request_replay" };
      }
      if (this.#byIdempotencyKey.size >= this.#config.maxCacheEntries) {
        emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "service_not_ready" });
        return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "service_not_ready" };
      }

      let result: StagingIssuancePortResultV0;
      if (request.scenario === "issue_reject") {
        result = Object.freeze({ kind: "simulated_issuance_rejected_v0", reasonCode: "scenario_issue_reject" });
      } else if (request.scenario === "issue_unavailable") {
        result = Object.freeze({ kind: "simulated_issuance_unavailable_v0", reasonCode: "scenario_issue_unavailable" });
      } else {
        const issuedAt = now.toISOString();
        const expiresAt = new Date(
          Math.min(Date.parse(request.expiresAt), Date.parse(request.biometricReceipt.expiresAt), now.getTime() + this.#config.credentialTtlMs),
        ).toISOString();
        if (Date.parse(expiresAt) <= now.getTime()) {
          return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "invalid_request" };
        }
        const credentialId = `sim-credential-${(await sha256Hex(`staging-credential-v0:${fingerprint}`)).slice(0, 32)}`;
        const unsigned: SimulatedStagingCredentialV0 = {
          kind: SIMULATED_STAGING_CREDENTIAL_V0,
          version: STAGING_ISSUANCE_PORT_V0,
          mode: SIMULATION_MODE,
          environment: SIMULATION_ENVIRONMENT,
          credentialId,
          issuer: SIMULATED_STAGING_ISSUER_V0,
          audience: SIMULATED_STAGING_AUDIENCE_V0,
          issuanceRequestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          nonceDigestSha256: request.nonceDigestSha256,
          subjectAccountId: request.accountId,
          accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
          simulationReceiptId: request.biometricReceipt.receiptId,
          claims: {
            biometricVerification: "simulated_not_performed",
            uniqueness: "not_performed",
            credentialClass: "not_selfie_check",
          },
          issuedAt,
          expiresAt,
          authentication: {
            scheme: "staging-ed25519",
            keyId: this.#config.credentialSigner.keyId,
            signatureBase64Url: "pending",
          } satisfies StagingAuthenticationV0,
        };
        const signedCredential = await signCredential(unsigned, this.#config.credentialSigner);
        const credential = Object.freeze({
          ...signedCredential,
          claims: Object.freeze({ ...signedCredential.claims }),
          authentication: Object.freeze({ ...signedCredential.authentication }),
        });
        result = Object.freeze({ kind: "simulated_credential_ready_v0", credential });
      }

      this.#byIdempotencyKey.set(request.idempotencyKey, {
        fingerprint,
        requestId: request.requestId,
        result,
        expiresAtMs: Math.min(
          Date.parse(request.expiresAt),
          Date.parse(request.biometricReceipt.expiresAt),
        ),
      });
      this.#requestIds.set(request.requestId, request.idempotencyKey);
      emitAudit(
        this.#config.audit,
        result.kind === "simulated_credential_ready_v0"
          ? { event: "credential_created" }
          : { event: "scenario_result", reasonCode: result.reasonCode },
      );
      return result;
    } catch {
      emitAudit(this.#config.audit, { event: "request_rejected", reasonCode: "invalid_request" });
      return { kind: STAGING_ISSUANCE_ERROR_V0, reasonCode: "invalid_request" };
    }
  }
}
