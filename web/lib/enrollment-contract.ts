import { keccak256, stringToHex } from "viem";
import { z } from "zod";

// PVS uses FieldElement::from_arbitrary_raw_bytes(b"enrollment"): Keccak-256 >> 8.
export const ENROLLMENT_CONTEXT = `0x${(BigInt(keccak256(stringToHex("enrollment"))) >> 8n).toString(16)}`;

const FIELDS = [
  "contract_version", "sub", "capture_id", "timestamp",
  "face_embedding_shares_0", "face_embedding_shares_1", "face_embedding_shares_2",
  "face_embedding_version", "face_embedding_type", "face_embedding_inference_backend",
  "pcp_version", "associated_data_hash",
] as const;

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) &&
    value !== "00000000-0000-0000-0000-000000000000";
}

export function isCanonicalSubject(value: unknown): value is string {
  return typeof value === "string" && /^0x[1-9a-f][0-9a-f]{0,63}$/.test(value);
}

function canonicalBase64(value: string, minBytes: number, maxBytes: number): boolean {
  if (value.length > Math.ceil(maxBytes / 3) * 4 || value.length % 4 !== 0) return false;
  try {
    const bytes = atob(value);
    return bytes.length >= minBytes && bytes.length <= maxBytes && btoa(bytes) === value;
  } catch {
    return false;
  }
}

const BUNDLE_ERROR = "Invalid TEE enrollment bundle";
const FIELD_ERROR = "Invalid or duplicate TEE enrollment field";
const allowedFields = new Set<string>(FIELDS);

const EnrollmentFieldSchema = z.object({
  name: z.string({ error: FIELD_ERROR }).refine(name => allowedFields.has(name), FIELD_ERROR),
  value: z.string({ error: FIELD_ERROR }).refine(value => value.length > 0 && new TextEncoder().encode(value).length <= 8192, FIELD_ERROR),
}, { error: FIELD_ERROR }).readonly();

export const EnrollmentCaptureSchema = z.object({
  fields: z.custom<unknown[]>(value => Array.isArray(value) && value.length === FIELDS.length, BUNDLE_ERROR)
    .pipe(z.array(EnrollmentFieldSchema)
      .refine(fields => new Set(fields.map(field => field.name)).size === fields.length, FIELD_ERROR))
    .readonly(),
  attestation_header: z.string({ error: BUNDLE_ERROR }).refine(value => canonicalBase64(value, 1, 12_000), BUNDLE_ERROR),
}, { error: BUNDLE_ERROR }).superRefine((capture, context) => {
  if (context.issues.length) return;
  const fields = new Map(capture.fields.map(field => [field.name, field.value]));
  const sub = fields.get("sub");
  const captureId = fields.get("capture_id");
  const timestamp = fields.get("timestamp")!;
  if (fields.get("contract_version") !== "2" || !isCanonicalSubject(sub) || !isCanonicalUuid(captureId) ||
    !/^[1-9][0-9]{0,18}$/.test(timestamp) || BigInt(timestamp) > 9_223_372_036_854_775_807n ||
    !/^0x[0-9a-f]{64}$/.test(fields.get("associated_data_hash")!)) {
    context.addIssue({ code: "custom", message: "Invalid TEE enrollment identifiers or contract version" });
    return;
  }
  for (const party of [0, 1, 2]) {
    if (!canonicalBase64(fields.get(`face_embedding_shares_${party}`)!, 48, 6144)) {
      context.addIssue({ code: "custom", message: "Invalid encrypted enrollment share" });
      return;
    }
  }
}).readonly();

export const EnrollmentChallengeSchema = z.object({
  challenge_id: z.string().refine(isCanonicalUuid),
  nonce: z.string().regex(/^0x[0-9a-f]{64}$/),
  challenge_type: z.literal("enrollment"),
  expires_at: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/)
    .refine(value => Number.isFinite(Date.parse(value))).pipe(z.iso.datetime({ offset: true })),
}).readonly();

export type EnrollmentCapture = z.infer<typeof EnrollmentCaptureSchema>;
export type EnrollmentChallenge = z.infer<typeof EnrollmentChallengeSchema>;

/** Validate the v2 wire shape without normalizing any attested field. */
export function validateEnrollmentCapture(value: unknown): { sub: string; captureId: string } {
  const parsed = EnrollmentCaptureSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    throw new TypeError(issues.some(issue => issue.message === BUNDLE_ERROR) ? BUNDLE_ERROR : issues[0].message);
  }
  const fields = new Map(parsed.data.fields.map(field => [field.name, field.value]));
  return { sub: fields.get("sub")!, captureId: fields.get("capture_id")! };
}

export function parseEnrollmentChallenge(value: unknown, now = Date.now()): EnrollmentChallenge {
  const parsed = EnrollmentChallengeSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("Invalid enrollment ownership challenge");
  }
  if (Date.parse(parsed.data.expires_at) <= now) throw new Error("Enrollment ownership challenge expired; obtain a fresh challenge");
  return parsed.data;
}
