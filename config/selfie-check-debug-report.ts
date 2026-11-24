import { z } from "zod";

export const MAX_DEBUG_MILESTONES = 12;

const DiagnosticStageSchema = z.enum([
  "request", "passkey", "capture", "wallet_ready", "credential_prepare", "camera", "poseguard",
  "enrollment_authorize", "enrollment_submit", "enrollment_poll", "credential_store",
  "proof_generate", "proof_validate", "proof_share", "demo_verify",
]);

const DiagnosticOutcomeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("failed"), reason: z.enum([
    "operation_failed", "timeout", "passkey_not_allowed", "permission_denied", "device_unavailable", "aborted", "enrollment_failed",
  ]) }),
  z.strictObject({ type: z.literal("rejected"), reason: z.enum([
    "quality_rejected", "challenge_rejected", "poseguard_rejected", "not_unique", "nullifier_replay",
  ]), step: z.int().min(1).max(4).optional() }),
  z.strictObject({ type: z.literal("pending"), reason: z.enum(["enrollment_pending", "credential_store_pending"]) }),
  z.strictObject({ type: z.literal("cancelled"), reason: z.literal("user_cancelled") }),
  z.strictObject({ type: z.literal("expired"), reason: z.literal("request_expired") }),
  z.strictObject({ type: z.literal("interrupted"), reason: z.enum(["tab_backgrounded", "page_left"]) }),
]);

const DiagnosticMilestoneSchema = z.strictObject({ stage: DiagnosticStageSchema, elapsedMs: z.int().nonnegative() });

export const SelfieCheckDebugReportSchema = z.strictObject({
  sessionId: z.uuidv4(),
  ts: z.int().nonnegative(),
  metadata: z.strictObject({
    schemaVersion: z.literal(1),
    os: z.literal("web"),
    flowId: z.uuidv4(),
    environment: z.enum(["staging", "sandbox", "production"]),
    elapsedMs: z.int().nonnegative(),
    stage: DiagnosticStageSchema,
    outcome: DiagnosticOutcomeSchema,
    milestones: z.array(DiagnosticMilestoneSchema).min(1).max(MAX_DEBUG_MILESTONES),
  }),
});

export type DiagnosticStage = z.infer<typeof DiagnosticStageSchema>;
export type DiagnosticOutcome = z.infer<typeof DiagnosticOutcomeSchema>;
export type DiagnosticMilestone = z.infer<typeof DiagnosticMilestoneSchema>;
export type SelfieCheckDebugReport = z.infer<typeof SelfieCheckDebugReportSchema>;
