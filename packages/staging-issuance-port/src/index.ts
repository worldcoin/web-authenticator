import type {
  ExpectedStagingIssuanceRequestV0,
  StagingIssuanceSimulationRequestV0,
  StagingIssuanceSimulationResultV0,
} from "../../contracts/src";

export const STAGING_ISSUANCE_ERROR_V0 = "staging_issuance_error_v0" as const;

export type StagingIssuanceErrorReasonV0 =
  | "invalid_request"
  | "non_pass_receipt"
  | "idempotency_conflict"
  | "request_replay"
  | "service_not_ready";

export type StagingIssuancePortResultV0 =
  | StagingIssuanceSimulationResultV0
  | {
      readonly kind: typeof STAGING_ISSUANCE_ERROR_V0;
      readonly reasonCode: StagingIssuanceErrorReasonV0;
    };

export interface StagingIssuanceInvocationV0 {
  readonly request: unknown;
  readonly expected: ExpectedStagingIssuanceRequestV0;
}

export interface StagingIssuancePortV0 {
  issue(invocation: StagingIssuanceInvocationV0): Promise<StagingIssuancePortResultV0>;
  readiness(): Readonly<{ ready: boolean; reasonCode?: "service_not_ready" }>;
}

export type { StagingIssuanceSimulationRequestV0 };
