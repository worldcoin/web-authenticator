import type {
  BiometricSimulationScenarioV0,
  HexSha256,
  Identifier,
  IsoDateTime,
} from "./common";
import { SIMULATION_ENVIRONMENT, SIMULATION_MODE } from "./common";
import type { IssuanceSimulationScenarioV0 } from "./staging-issuance-port-v0";

export const ENROLLMENT_SESSION_V2 = "enrollment_session_v2" as const;

export const ENROLLMENT_SESSION_STATES_V2 = [
  "created",
  "passkey_complete",
  "capture_ready",
  "biometric_simulation_pending",
  "simulated_pass",
  "simulated_reject",
  "simulated_retry",
  "simulated_unavailable",
  "issuance_simulation_pending",
  "simulated_issuance_reject",
  "simulated_issuance_unavailable",
  "simulated_credential_ready",
  "cancelled",
  "expired",
] as const;

export type EnrollmentSessionStateV2 = (typeof ENROLLMENT_SESSION_STATES_V2)[number];

export interface EnrollmentSessionV2 {
  readonly version: typeof ENROLLMENT_SESSION_V2;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly sessionId: Identifier;
  readonly rpRequestDigestSha256: HexSha256;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly nonceBase64Url: string;
  readonly idempotencyKey: Identifier;
  readonly biometricScenario: BiometricSimulationScenarioV0;
  readonly issuanceScenario: IssuanceSimulationScenarioV0;
  readonly state: EnrollmentSessionStateV2;
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export const ENROLLMENT_SESSION_TRANSITIONS_V2: Readonly<
  Record<EnrollmentSessionStateV2, readonly EnrollmentSessionStateV2[]>
> = {
  created: ["passkey_complete", "cancelled", "expired"],
  passkey_complete: ["capture_ready", "cancelled", "expired"],
  capture_ready: ["biometric_simulation_pending", "cancelled", "expired"],
  biometric_simulation_pending: [
    "simulated_pass",
    "simulated_reject",
    "simulated_retry",
    "simulated_unavailable",
    "expired",
  ],
  simulated_pass: ["issuance_simulation_pending", "expired"],
  simulated_reject: [],
  simulated_retry: ["capture_ready", "cancelled", "expired"],
  simulated_unavailable: ["biometric_simulation_pending", "cancelled", "expired"],
  issuance_simulation_pending: [
    "simulated_credential_ready",
    "simulated_issuance_reject",
    "simulated_issuance_unavailable",
    "expired",
  ],
  simulated_issuance_reject: [],
  simulated_issuance_unavailable: ["issuance_simulation_pending", "cancelled", "expired"],
  simulated_credential_ready: [],
  cancelled: [],
  expired: [],
};

export function isEnrollmentTransitionAllowedV2(
  from: EnrollmentSessionStateV2,
  to: EnrollmentSessionStateV2,
): boolean {
  return ENROLLMENT_SESSION_TRANSITIONS_V2[from].includes(to);
}

// V2 supersedes V1 for implementation because V1 collapsed issuance failures into biometric states.
