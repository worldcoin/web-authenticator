import { expect, test } from "bun:test";
import { ENROLLMENT_CONTEXT, EnrollmentCaptureSchema, parseEnrollmentChallenge, validateEnrollmentCapture } from "../lib/enrollment-contract";
import { CAPTURE_ID, enrollmentCapture, enrollmentChallenge } from "./fixtures/enrollment";

test("enrollment context matches the proof-verification service's field element", () => {
  expect(BigInt(ENROLLMENT_CONTEXT)).toBe(BigInt("0x0008a52ed08c9195e9e08fd66805cd2421a53f4719ff668abcfebbcc2d2a4ed2"));
});

test("v2 capture validation preserves the attested bytes, including old captures for authorized retries", () => {
  const capture = enrollmentCapture();
  const before = JSON.stringify(capture);
  const parsed = EnrollmentCaptureSchema.parse(capture);
  expect(parsed).toEqual(capture);
  expect(validateEnrollmentCapture(parsed)).toEqual({ sub: "0x1f", captureId: CAPTURE_ID });
  expect(JSON.stringify(capture)).toBe(before);
});

test("capture parsing rejects malformed field shapes before invariant validation", () => {
  const capture = enrollmentCapture();
  for (const value of [
    null, [], {}, { ...capture, fields: null }, { ...capture, attestation_header: 42 },
    ...[null, {}, { name: 42, value: "value" }, { name: "sub", value: 42 }, { name: "sub", value: "" }]
      .map(field => ({ ...capture, fields: [field, ...capture.fields.slice(1)] })),
  ]) expect(EnrollmentCaptureSchema.safeParse(value).success).toBe(false);
});

test("capture validation rejects omitted, unknown, duplicate and oversized fields", () => {
  const capture = enrollmentCapture();
  for (const fields of [
    capture.fields.slice(1),
    [...capture.fields.slice(1), { name: "unknown", value: "value" }],
    [...capture.fields.slice(1), capture.fields[1]],
    capture.fields.map(field => field.name === "pcp_version" ? { ...field, value: "é".repeat(4097) } : field),
  ]) {
    expect(() => validateEnrollmentCapture(EnrollmentCaptureSchema.parse({ ...capture, fields }))).toThrow();
  }
});

test("capture validation rejects noncanonical signed values rather than normalizing them", () => {
  const capture = enrollmentCapture();
  for (const [name, value] of [
    ["contract_version", "1"], ["sub", "0x01f"], ["sub", "0x1F"], ["sub", "0x0"],
    ["capture_id", CAPTURE_ID.toUpperCase()], ["capture_id", "00000000-0000-0000-0000-000000000000"],
    ["timestamp", "01700000000"], ["timestamp", "9223372036854775808"],
    ["associated_data_hash", "0x01"], ["face_embedding_shares_0", btoa("too short")],
    ["face_embedding_shares_1", "not base64"],
  ]) {
    const fields = capture.fields.map(field => field.name === name ? { name, value } : field);
    expect(() => validateEnrollmentCapture(EnrollmentCaptureSchema.parse({ ...capture, fields }))).toThrow();
  }
  for (const attestation_header of ["", " Zg==", "Zh==", btoa("a".repeat(12_001))]) {
    expect(EnrollmentCaptureSchema.safeParse({ ...capture, attestation_header }).success).toBe(false);
  }
});

test("only a fresh enrollment-purpose challenge is accepted", () => {
  const challenge = enrollmentChallenge();
  expect(parseEnrollmentChallenge(challenge)).toEqual(challenge);
  for (const invalid of [
    null, { ...challenge, challenge_type: "teedi_migration" },
    { ...challenge, challenge_id: "invalid" }, { ...challenge, nonce: "0x01" },
    { ...challenge, expires_at: "tomorrow" },
    { ...challenge, expires_at: new Date(Date.now() - 1).toISOString() },
  ]) expect(() => parseEnrollmentChallenge(invalid)).toThrow();
});
