import type {
  BiometricSimulationRequestV0,
  ExpectedBiometricSimulationRequestV0,
  SimulationCapturePolicyV0,
  SimulationReceiptV0,
} from "../../contracts/src";

export const BIOMETRIC_SIMULATION_ERROR_V0 = "biometric_simulation_error_v0" as const;
export const SIMULATION_RECEIPT_READY_V0 = "simulation_receipt_ready_v0" as const;

export type BiometricSimulationErrorReasonV0 =
  | "invalid_request"
  | "idempotency_conflict"
  | "request_replay"
  | "service_not_ready";

export type BiometricVerificationResultV0 =
  | {
      readonly kind: typeof SIMULATION_RECEIPT_READY_V0;
      readonly receipt: SimulationReceiptV0;
    }
  | {
      readonly kind: typeof BIOMETRIC_SIMULATION_ERROR_V0;
      readonly reasonCode: BiometricSimulationErrorReasonV0;
    };

export interface BiometricVerificationInvocationV0 {
  readonly request: unknown;
  readonly expected: ExpectedBiometricSimulationRequestV0;
  readonly capturePolicy: SimulationCapturePolicyV0;
}

export interface BiometricVerificationPortV0 {
  verify(invocation: BiometricVerificationInvocationV0): Promise<BiometricVerificationResultV0>;
  readiness(): Readonly<{ ready: boolean; reasonCode?: "service_not_ready" }>;
}

// The server supplies `expected`, including the scenario. A browser request is never authoritative.
export type { BiometricSimulationRequestV0 };
