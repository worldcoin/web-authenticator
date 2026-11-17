import { keccak256, stringToHex } from "viem";
import { z } from "zod";

export interface EnrollmentCapture {
  readonly fields: readonly Readonly<{ name: string; value: string }>[];
  readonly attestation_header: string;
}

export interface EnrollmentChallenge {
  readonly challenge_id: string;
  readonly nonce: string;
  readonly challenge_type: "enrollment";
  readonly expires_at: string;
}

// PVS uses FieldElement::from_arbitrary_raw_bytes(b"enrollment"): Keccak-256 >> 8.
export const ENROLLMENT_CONTEXT = `0x${(BigInt(keccak256(stringToHex("enrollment"))) >> 8n).toString(16)}`;

const FIELDS = [
  "contract_version", "sub", "capture_id", "timestamp",
  "face_embedding_shares_0", "face_embedding_shares_1", "face_embedding_shares_2",
  "face_embedding_version", "face_embedding_type", "face_embedding_inference_backend",
  "pcp_version", "associated_data_hash",
] as const;

export const EnrollmentCaptureSchema: z.ZodType<EnrollmentCapture> = z.object({
  fields: z.array(z.object({
    name: z.string(),
    value: z.string().min(1).refine(value => new TextEncoder().encode(value).length <= 8192),
  })).length(FIELDS.length),
  attestation_header: z.string().refine(value => canonicalBase64(value, 1, 12_000)),
});

const EnrollmentChallengeSchema: z.ZodType<EnrollmentChallenge> = z.object({
  challenge_id: z.string().refine(isCanonicalUuid),
  nonce: z.string().regex(/^0x[0-9a-f]{64}$/),
  challenge_type: z.literal("enrollment"),
  expires_at: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/)
    .refine(value => Number.isFinite(Date.parse(value))),
});

/** Validate the invariants of a schema-parsed capture without normalizing attested fields. */
export function validateEnrollmentCapture(value: EnrollmentCapture): { sub: string; captureId: string } {
  const fields = new Map<string, string>();
  const allowed = new Set<string>(FIELDS);
  for (const field of value.fields) {
    if (!allowed.has(field.name) || fields.has(field.name)) {
      throw new TypeError("Invalid or duplicate TEE enrollment field");
    }
    fields.set(field.name, field.value);
  }
  const sub = fields.get("sub");
  const captureId = fields.get("capture_id");
  const timestamp = fields.get("timestamp")!;
  if (fields.get("contract_version") !== "2" || !isCanonicalSubject(sub) || !isCanonicalUuid(captureId) ||
    !/^[1-9][0-9]{0,18}$/.test(timestamp) || BigInt(timestamp) > 9_223_372_036_854_775_807n ||
    !/^0x[0-9a-f]{64}$/.test(fields.get("associated_data_hash")!)) {
    throw new TypeError("Invalid TEE enrollment identifiers or contract version");
  }
  for (const party of [0, 1, 2]) {
    if (!canonicalBase64(fields.get(`face_embedding_shares_${party}`)!, 48, 6144)) {
      throw new TypeError("Invalid encrypted enrollment share");
    }
  }
  return { sub, captureId };
}

export function parseEnrollmentChallenge(value: unknown, now = Date.now()): EnrollmentChallenge {
  const parsed = EnrollmentChallengeSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid enrollment ownership challenge");
  if (Date.parse(parsed.data.expires_at) <= now) throw new Error("Enrollment ownership challenge expired; obtain a fresh challenge");
  return parsed.data;
}

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
