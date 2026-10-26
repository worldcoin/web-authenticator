/** Deliberately closed vocabulary: no request, account, biometric or error payloads. */
export const ANALYTICS_STEPS = [
  "request", "request_eligibility", "request_expiry", "request_cancellation", "request_dismissal",
  "selfie_capture", "camera", "face_guidance", "physical_challenge",
  "save_decision", "save_access", "authenticator_access", "passkey_create", "passkey_unlock",
  "wallet_initialize", "registration_submit", "registration_poll", "registration_initialize",
  "credential_preparation", "credential_storage", "proof_generation", "proof_delivery",
] as const;
export const ANALYTICS_STATUSES = ["started", "completed", "failed", "cancelled", "skipped"] as const;
export const ANALYTICS_REASONS = [
  "timeout", "cancelled", "permission_denied", "camera_missing", "camera_busy", "unsupported",
  "invalid_state", "storage_full", "invalid_data", "network_error", "expired", "operation_error",
] as const;
export type AnalyticsStep = typeof ANALYTICS_STEPS[number];
export type AnalyticsStatus = typeof ANALYTICS_STATUSES[number];
export type AnalyticsReason = typeof ANALYTICS_REASONS[number];
export type AnalyticsEntryPoint = "deeplink" | "direct";
export type AnalyticsEvent = {
  uuid: string;
  flow_id: string;
  sequence: number;
  timestamp: string;
  step: AnalyticsStep;
  status: AnalyticsStatus;
  entry_point: AnalyticsEntryPoint;
  attempt: number;
  duration_ms?: number;
  reason?: AnalyticsReason;
};
export const ANALYTICS_BATCH_SIZE = 16;
export const ANALYTICS_BODY_LIMIT = 16_384;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const integer = (value: unknown, max: number) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
const keys = new Set(["uuid", "flow_id", "sequence", "timestamp", "step", "status", "entry_point", "attempt", "duration_ms", "reason"]);

/** Validate at both boundaries; reject unknown fields instead of forwarding them. */
export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return Object.keys(e).every(key => keys.has(key)) &&
    typeof e.uuid === "string" && uuid.test(e.uuid) && typeof e.flow_id === "string" && uuid.test(e.flow_id) &&
    integer(e.sequence, 1_000_000) && integer(e.attempt, 10_000) &&
    typeof e.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.timestamp) && Number.isFinite(Date.parse(e.timestamp)) &&
    ANALYTICS_STEPS.includes(e.step as AnalyticsStep) && ANALYTICS_STATUSES.includes(e.status as AnalyticsStatus) &&
    (e.entry_point === "deeplink" || e.entry_point === "direct") &&
    (e.duration_ms === undefined || integer(e.duration_ms, 3_600_000)) &&
    (e.reason === undefined || ANALYTICS_REASONS.includes(e.reason as AnalyticsReason));
}
