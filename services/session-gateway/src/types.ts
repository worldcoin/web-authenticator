import type {
  BiometricSimulationScenarioV0,
  EnrollmentSessionV2,
  FrameBundleV0,
  HexSha256,
  IssuanceSimulationScenarioV0,
  RuntimeEnvironment,
  SimulatedStagingCredentialV0,
  SimulationCapturePolicyV0,
  SimulationReceiptV0,
  StagingEd25519TrustRootV0,
} from "../../../packages/contracts/src";
import type { BiometricVerificationPortV0 } from "../../../packages/biometric-verification-port/src";
import type { StagingIssuancePortV0 } from "../../../packages/staging-issuance-port/src";

export interface RequestContextV0 {
  readonly origin: string;
  readonly rpId: string;
  readonly authenticatedServerContext?: unknown;
}

export interface VerifiedRpRequestV0 {
  readonly rpId: string;
  readonly origin: string;
  readonly returnTarget: string;
  readonly requestDigestSha256: HexSha256;
}

export interface RpRequestVerifierV0 {
  verify(request: unknown, context: RequestContextV0, now: string): Promise<VerifiedRpRequestV0 | null>;
}

export interface BrowserCeremonyVerifierV0 {
  verify(
    ceremony: unknown,
    expected: {
      readonly sessionId: string;
      readonly rpId: string;
      readonly origin: string;
      readonly accountPublicMaterialDigestSha256: HexSha256;
      readonly now: string;
    },
  ): Promise<boolean>;
}

export interface ServerScenarioSelectionV0 {
  readonly biometric: BiometricSimulationScenarioV0;
  readonly issuance: IssuanceSimulationScenarioV0;
}

export interface ServerScenarioSelectorV0 {
  select(input: {
    readonly verifiedRpRequest: VerifiedRpRequestV0;
    readonly authenticatedServerContext: unknown;
  }): Promise<ServerScenarioSelectionV0>;
}

export interface GatewayRequestSignerV0 {
  readonly trustRoot: StagingEd25519TrustRootV0;
  sign(preimage: Uint8Array): Promise<string>;
}

export interface GatewayAuditEventV0 {
  readonly event:
    | "session_created"
    | "passkey_complete"
    | "capture_ready"
    | "simulation_finished"
    | "issuance_finished"
    | "session_expired"
    | "session_cancelled";
  readonly sessionId: string;
  readonly state: EnrollmentSessionV2["state"];
  readonly code?: GatewayStatusCodeV0;
}

export interface GatewayAuditSinkV0 {
  record(event: GatewayAuditEventV0): void;
}

export interface GatewayClockV0 {
  now(): Date;
}

export type CapturePolicyTemplateV0 = Omit<SimulationCapturePolicyV0, "expiresAt">;

export interface SessionGatewayConfigV0 {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly enabled: boolean;
  readonly sessionTtlMs: number;
  readonly maxRequestBodyBytes: number;
  readonly maxConcurrentOperations: number;
  readonly simulatorTimeoutMs: number;
  readonly capturePolicy: CapturePolicyTemplateV0;
  readonly allowedSyntheticFixtureIds: readonly string[];
  readonly handleKey: CryptoKey;
  readonly rpRequestVerifier: RpRequestVerifierV0;
  readonly ceremonyVerifier: BrowserCeremonyVerifierV0;
  readonly scenarioSelector: ServerScenarioSelectorV0;
  readonly biometricRequestSigner: GatewayRequestSignerV0;
  readonly issuanceRequestSigner: GatewayRequestSignerV0;
  readonly biometricReceiptTrustRoot: StagingEd25519TrustRootV0;
  readonly simulatedCredentialTrustRoot: StagingEd25519TrustRootV0;
  readonly biometricClient: BiometricVerificationPortV0;
  readonly issuanceClient: StagingIssuancePortV0;
  readonly auditSink?: GatewayAuditSinkV0;
  readonly clock?: GatewayClockV0;
}

export type GatewayStatusCodeV0 =
  | "created"
  | "passkey_complete"
  | "capture_ready"
  | "simulation_pass"
  | "simulation_reject"
  | "simulation_retry"
  | "simulation_unavailable"
  | "issuance_rejected"
  | "issuance_unavailable"
  | "simulated_credential_ready"
  | "cancelled"
  | "expired";

export interface SessionStatusV0 {
  readonly session: EnrollmentSessionV2;
  readonly code: GatewayStatusCodeV0;
  readonly retryable: boolean;
}

export interface CreateSessionResultV0 extends SessionStatusV0 {
  readonly browserHandle: string;
  readonly capturePolicy: SimulationCapturePolicyV0;
}

export interface SubmitCaptureResultV0 extends SessionStatusV0 {
  readonly credential?: SimulatedStagingCredentialV0;
}

export interface StoredSessionV0 {
  session: EnrollmentSessionV2;
  readonly rpId: string;
  readonly origin: string;
  readonly returnTarget: string;
  readonly accountId: string;
  nonceConsumed: boolean;
  captureAttempt: number;
  frameBundle?: FrameBundleV0;
  artifactDigestSha256?: HexSha256;
  biometricRequestId?: string;
  biometricIdempotencyKey?: string;
  biometricRequestedAt?: string;
  receiptId?: string;
  issuanceRequestId?: string;
  issuanceIdempotencyKey?: string;
  issuanceRequestedAt?: string;
  statusCode: GatewayStatusCodeV0;
  readonly operationResults: Map<string, SessionStatusV0>;
  readonly operationRequestDigests: Map<string, HexSha256>;
}

export interface SessionRepositoryV0 {
  get(sessionId: string): StoredSessionV0 | undefined;
  put(record: StoredSessionV0): void;
  findByCreationIdempotency(rpId: string, idempotencyKey: string): StoredSessionV0 | undefined;
  purgeExpired(nowMs: number): number;
}

export interface ExpectedReceiptContextV0 {
  readonly receipt: SimulationReceiptV0;
  readonly frameBundle: FrameBundleV0;
}
