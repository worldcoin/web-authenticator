import type {
  BiometricSimulationScenarioV0,
  HexSha256,
  Identifier,
  IsoDateTime,
} from "./common";
import { SIMULATION_ENVIRONMENT, SIMULATION_MODE } from "./common";

export const ENROLLMENT_SESSION_V1 = "enrollment_session_v1" as const;

export const ENROLLMENT_SESSION_STATES_V1 = [
  "created",
  "passkey_complete",
  "capture_ready",
  "simulation_pending",
  "simulated_pass",
  "simulated_reject",
  "simulated_retry",
  "simulated_unavailable",
  "issuance_pending",
  "simulated_credential_ready",
  "cancelled",
  "expired",
] as const;

export type EnrollmentSessionStateV1 = (typeof ENROLLMENT_SESSION_STATES_V1)[number];

export interface EnrollmentSessionV1 {
  readonly version: typeof ENROLLMENT_SESSION_V1;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly sessionId: Identifier;
  readonly rpRequestDigestSha256: HexSha256;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly nonceBase64Url: string;
  readonly idempotencyKey: Identifier;
  readonly biometricScenario: BiometricSimulationScenarioV0;
  readonly state: EnrollmentSessionStateV1;
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export const ENROLLMENT_SESSION_TRANSITIONS_V1: Readonly<
  Record<EnrollmentSessionStateV1, readonly EnrollmentSessionStateV1[]>
> = {
  created: ["passkey_complete", "cancelled", "expired"],
  passkey_complete: ["capture_ready", "cancelled", "expired"],
  capture_ready: ["simulation_pending", "cancelled", "expired"],
  simulation_pending: [
    "simulated_pass",
    "simulated_reject",
    "simulated_retry",
    "simulated_unavailable",
    "expired",
  ],
  simulated_pass: ["issuance_pending", "expired"],
  simulated_reject: [],
  simulated_retry: ["capture_ready", "cancelled", "expired"],
  simulated_unavailable: ["simulation_pending", "cancelled", "expired"],
  issuance_pending: ["simulated_credential_ready", "simulated_unavailable", "expired"],
  simulated_credential_ready: [],
  cancelled: [],
  expired: [],
};

export function isEnrollmentTransitionAllowedV1(
  from: EnrollmentSessionStateV1,
  to: EnrollmentSessionStateV1,
): boolean {
  return ENROLLMENT_SESSION_TRANSITIONS_V1[from].includes(to);
}
