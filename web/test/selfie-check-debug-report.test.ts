import { expect, spyOn, test } from "bun:test";
import { MAX_DEBUG_MILESTONES, SelfieCheckDebugReportSchema, type SelfieCheckDebugReport } from "../../config/selfie-check-debug-report";
import { uploadDebugReport } from "../lib/debug-report";
import { createSelfieCheckDiagnostics } from "../lib/selfie-check-debug-report";

const config = { apiOrigin: "https://presign.example", uploadOrigin: "https://reports.example" };
const uploadUrl = `${config.uploadOrigin}/report.json?signature=test`;
const report = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  ts: 123,
  metadata: {
    schemaVersion: 1,
    os: "web",
    flowId: "00000000-0000-4000-8000-000000000002",
    environment: "sandbox",
    stage: "poseguard",
    outcome: { type: "rejected", reason: "quality_rejected", step: 2 },
    elapsedMs: 30,
    milestones: [{ stage: "camera", elapsedMs: 0 }, { stage: "poseguard", elapsedMs: 5 }],
  },
} satisfies SelfieCheckDebugReport;

test("reports once per failed attempt with bounded context and a shared opaque flow ID", async () => {
  const reports: SelfieCheckDebugReport[] = [];
  const diagnostics = createSelfieCheckDiagnostics(async report => { reports.push(SelfieCheckDebugReportSchema.parse(report)); });
  const start = diagnostics.forRequest("sandbox");
  expect(start("passkey")).toBeUndefined();
  diagnostics.setConsent("granted");
  const first = start("passkey")!;
  for (let index = 0; index < MAX_DEBUG_MILESTONES; index++) {
    first.enter("camera");
    first.enter("poseguard");
  }
  first.finish({ type: "rejected", reason: "quality_rejected", step: 2 });
  first.fail(new Error("private message"));
  const retry = start("enrollment_poll")!;
  retry.finish({ type: "pending", reason: "enrollment_pending" });
  const success = start("credential_store")!;
  success.finish();
  success.fail(new Error("late failure"));
  await Promise.resolve();

  expect(reports).toHaveLength(2);
  expect(reports[0]?.metadata).toMatchObject({ environment: "sandbox", stage: "poseguard", outcome: report.metadata.outcome });
  expect(reports[0]?.metadata.milestones).toHaveLength(MAX_DEBUG_MILESTONES);
  expect(reports[1]?.metadata.outcome).toEqual({ type: "pending", reason: "enrollment_pending" });
  expect(reports[0]?.metadata.flowId).toBe(reports[1]?.metadata.flowId);
  expect(reports[0]?.sessionId).not.toBe(reports[1]?.sessionId);
  expect(JSON.stringify(reports)).not.toContain("private message");
});

test("revoking consent abandons active attempts and prevents queued reports", async () => {
  const reports: SelfieCheckDebugReport[] = [];
  const diagnostics = createSelfieCheckDiagnostics(async report => { reports.push(report); });
  diagnostics.setConsent("granted");
  const start = diagnostics.forRequest("staging");
  const active = start("passkey")!;
  start("camera")!.fail(new DOMException("private", "NotAllowedError"));
  diagnostics.setConsent("denied");
  expect(active.finished).toBe(true);
  expect(start("passkey")).toBeUndefined();
  diagnostics.setConsent("granted");
  active.finish({ type: "cancelled", reason: "user_cancelled" });
  await Promise.resolve();
  expect(reports).toEqual([]);
});

test("presigns and uploads the exact allowed report bytes with create-only headers", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(SelfieCheckDebugReportSchema.parse(report)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({
      url: uploadUrl,
      headers: { "Content-Type": ["application/json"], "Content-Length": [String(bytes.length)],
        "If-None-Match": ["*"], "X-Amz-Checksum-Sha256": ["checksum"], Authorization: ["untrusted"] },
    }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  try {
    await uploadDebugReport(report, config, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, presign] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${config.apiOrigin}/api/v1/data/web/report`);
    expect(JSON.parse(String(presign?.body))).toEqual({
      flowId: report.metadata.flowId, sessionId: report.sessionId, contentLength: bytes.length, sha256: Buffer.from(digest).toString("hex"),
    });
    const [signedUrl, upload] = fetch.mock.calls[1]!;
    expect(String(signedUrl)).toBe(uploadUrl);
    expect(upload?.body).toEqual(bytes);
    expect(upload?.credentials).toBe("omit");
    expect(Object.fromEntries(new Headers(upload?.headers))).toEqual({
      "content-type": "application/json", "if-none-match": "*", "x-amz-checksum-sha256": "checksum",
    });
  } finally {
    fetch.mockRestore();
  }
});

test.each([
  { url: "https://other.example/report.json", headers: { "If-None-Match": ["*"] } },
  { url: uploadUrl, headers: {} },
  { url: uploadUrl, headers: { "If-None-Match": ["*"], "Content-Length": ["1"] } },
])("rejects an invalid presign response without uploading the report", async presigned => {
  const fetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(presigned));
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await uploadDebugReport(report, config, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("selfie_check_debug_upload_failed", { stage: "presign", status: undefined });
  } finally {
    fetch.mockRestore();
    warn.mockRestore();
  }
});

test("rejects extra fields before presign and reports failed PUTs without exposing report data", async () => {
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ url: uploadUrl, headers: { "If-None-Match": ["*"] } }))
    .mockResolvedValueOnce(new Response("private upstream body", { status: 503 }));
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const signal = new AbortController().signal;
  try {
    const invalid = { ...report, metadata: { ...report.metadata, rawError: "private message" } };
    await uploadDebugReport(invalid, config, signal);
    expect(fetch).not.toHaveBeenCalled();
    await uploadDebugReport(report, config, signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("selfie_check_debug_upload_failed", { stage: "upload", status: 503 });
  } finally {
    fetch.mockRestore();
    warn.mockRestore();
  }
});

test("revoking consent during presign prevents the report body from being uploaded", async () => {
  const pending = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const fetch = spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL) => {
    expect(String(input)).toBe(`${config.apiOrigin}/api/v1/data/web/report`);
    started.resolve();
    return pending.promise;
  }) as typeof globalThis.fetch);
  const consent = new AbortController();
  try {
    const upload = uploadDebugReport(report, config, consent.signal);
    await started.promise;
    consent.abort();
    pending.resolve(Response.json({ url: uploadUrl, headers: { "If-None-Match": ["*"] } }));
    await upload;
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});
