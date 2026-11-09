import { keccak256, stringToHex } from "viem";

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

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) &&
    value !== "00000000-0000-0000-0000-000000000000";
}

export function isCanonicalSubject(value: unknown): value is string {
  return typeof value === "string" && /^0x[1-9a-f][0-9a-f]{0,63}$/.test(value);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** Validate the v2 wire shape without normalizing any attested field. */
export function validateEnrollmentCapture(value: unknown): { sub: string; captureId: string } {
  if (!object(value) || !Array.isArray(value.fields) || value.fields.length !== FIELDS.length ||
    typeof value.attestation_header !== "string" || !canonicalBase64(value.attestation_header, 1, 12_000)) {
    throw new TypeError("Invalid TEE enrollment bundle");
  }
  const fields = new Map<string, string>();
  const allowed = new Set<string>(FIELDS);
  for (const field of value.fields) {
    if (!object(field) || typeof field.name !== "string" || !allowed.has(field.name) || fields.has(field.name) ||
      typeof field.value !== "string" || field.value.length === 0 || new TextEncoder().encode(field.value).length > 8192) {
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
  if (!object(value) || !isCanonicalUuid(value.challenge_id) || value.challenge_type !== "enrollment" ||
    typeof value.nonce !== "string" || !/^0x[0-9a-f]{64}$/.test(value.nonce) ||
    typeof value.expires_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.expires_at) ||
    !Number.isFinite(Date.parse(value.expires_at))) {
    throw new TypeError("Invalid enrollment ownership challenge");
  }
  if (Date.parse(value.expires_at) <= now) throw new Error("Enrollment ownership challenge expired; obtain a fresh challenge");
  return {
    challenge_id: value.challenge_id,
    nonce: value.nonce,
    challenge_type: "enrollment",
    expires_at: value.expires_at,
  };
}
