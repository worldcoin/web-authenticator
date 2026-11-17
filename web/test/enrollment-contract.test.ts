import { expect, test } from "bun:test";
import { ENROLLMENT_CONTEXT, parseEnrollmentChallenge, validateEnrollmentCapture } from "../lib/enrollment-contract";
import { CAPTURE_ID, enrollmentCapture, enrollmentChallenge } from "./fixtures/enrollment";

test("enrollment context matches the proof-verification service's field element", () => {
  expect(BigInt(ENROLLMENT_CONTEXT)).toBe(BigInt("0x0008a52ed08c9195e9e08fd66805cd2421a53f4719ff668abcfebbcc2d2a4ed2"));
});

test("v2 capture validation preserves the attested bytes, including old captures for authorized retries", () => {
  const capture = enrollmentCapture();
  const before = JSON.stringify(capture);
  expect(validateEnrollmentCapture(capture)).toEqual({ sub: "0x1f", captureId: CAPTURE_ID });
  expect(JSON.stringify(capture)).toBe(before);
});

test("capture validation accepts byte limits, reordered fields and additive metadata unchanged", () => {
  const capture = enrollmentCapture();
  const replacements: Record<string, string> = {
    sub: `0x${"f".repeat(64)}`,
    capture_id: "01234567-89ab-0cde-0f01-23456789abcd",
    timestamp: "9223372036854775807",
    pcp_version: "é".repeat(4096),
    face_embedding_shares_0: btoa("a".repeat(48)),
    face_embedding_shares_1: btoa("a".repeat(6144)),
  };
  const bundle = {
    metadata: { version: 3 },
    attestation_header: btoa("a".repeat(12_000)),
    fields: capture.fields.map(field => ({ ...field, value: replacements[field.name] ?? field.value, metadata: "ignored" })).reverse(),
  };
  const before = JSON.stringify(bundle);
  expect(validateEnrollmentCapture(bundle)).toEqual({ sub: replacements.sub, captureId: replacements.capture_id });
  expect(JSON.stringify(bundle)).toBe(before);
});

test("malformed capture envelopes keep the existing safe error and validation priority", () => {
  const capture = enrollmentCapture();
  for (const value of [
    null, [], {}, { ...capture, fields: null }, { ...capture, fields: "fields" },
    ...[undefined, null, 42].map(attestation_header => ({ ...capture, attestation_header })),
    { ...capture, fields: capture.fields.map(() => null), attestation_header: "invalid" },
  ]) expect(() => validateEnrollmentCapture(value)).toThrow("Invalid TEE enrollment bundle");
});

test("capture validation rejects omitted, unknown, duplicate and oversized fields", () => {
  const capture = enrollmentCapture();
  for (const fields of [
    capture.fields.slice(1),
    [...capture.fields.slice(1), { name: "unknown", value: "value" }],
    [...capture.fields.slice(1), capture.fields[1]],
    capture.fields.map(field => field.name === "pcp_version" ? { ...field, value: "é".repeat(4097) } : field),
    ...[null, {}, { name: "pcp_version" }, { value: "1" }, { name: 42, value: "1" },
      { name: "pcp_version", value: null }, { name: "pcp_version", value: 1 }, { name: "pcp_version", value: "" },
    ].map(invalid => capture.fields.map(field => field.name === "pcp_version" ? invalid : field)),
  ]) {
    expect(() => validateEnrollmentCapture({ ...capture, fields })).toThrow();
  }
});

test("capture validation rejects noncanonical signed values rather than normalizing them", () => {
  const capture = enrollmentCapture();
  for (const [name, value] of [
    ["contract_version", "1"], ["sub", "0x01f"], ["sub", "0x1F"], ["sub", "0x0"],
    ["capture_id", CAPTURE_ID.toUpperCase()], ["capture_id", "00000000-0000-0000-0000-000000000000"],
    ["timestamp", "01700000000"], ["timestamp", "9223372036854775808"],
    ["timestamp", "0"], ["timestamp", "-1"], ["timestamp", "1.5"], ["timestamp", "12345678901234567890"],
    ["associated_data_hash", "0x01"], ["face_embedding_shares_0", btoa("too short")],
    ["face_embedding_shares_1", "not base64"],
    ["face_embedding_shares_2", btoa("a".repeat(6145))],
  ]) {
    const fields = capture.fields.map(field => field.name === name ? { name, value } : field);
    expect(() => validateEnrollmentCapture({ ...capture, fields })).toThrow();
  }
  for (const attestation_header of ["", " Zg==", "Zh==", btoa("a".repeat(12_001))]) {
    expect(() => validateEnrollmentCapture({ ...capture, attestation_header })).toThrow();
  }
});

test("only a fresh enrollment-purpose challenge is accepted", () => {
  const challenge = enrollmentChallenge();
  expect(parseEnrollmentChallenge(challenge)).toEqual(challenge);
  for (const invalid of [
    null, [], "challenge", { ...challenge, challenge_type: "teedi_migration" },
    ...["challenge_id", "nonce", "challenge_type", "expires_at"].flatMap(key =>
      [undefined, null, 42].map(value => ({ ...challenge, [key]: value }))),
    { ...challenge, challenge_id: "invalid" }, { ...challenge, nonce: "0x01" },
    { ...challenge, challenge_id: "00000000-0000-0000-0000-000000000000" },
    { ...challenge, nonce: `0x${"AB".repeat(32)}` },
    { ...challenge, expires_at: "tomorrow" },
    { ...challenge, expires_at: "2030-13-01T00:00:00Z" },
  ]) expect(() => parseEnrollmentChallenge(invalid)).toThrow("Invalid enrollment ownership challenge");
  const now = Date.now();
  for (const expires of [now - 1, now]) {
    expect(() => parseEnrollmentChallenge({ ...challenge, expires_at: new Date(expires).toISOString() }, now))
      .toThrow("Enrollment ownership challenge expired; obtain a fresh challenge");
  }
});

test("challenge parsing preserves accepted timestamps and strips only additive metadata", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  for (const expires_at of ["2030-01-01T00:15:00.1234567890Z", "2030-01-01T01:15:00+01:00", "2029-12-31T19:15:00-05:00"]) {
    const challenge = { ...enrollmentChallenge(), challenge_id: "01234567-89ab-0cde-0f01-23456789abcd", expires_at };
    const input = { ...challenge, metadata: { version: 3 } };
    const before = JSON.stringify(input);
    expect(parseEnrollmentChallenge(input, now)).toEqual(challenge);
    expect(JSON.stringify(input)).toBe(before);
  }
});
