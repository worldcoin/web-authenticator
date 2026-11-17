/* eslint-disable no-console -- Verify redacted operational logs. */
import { afterEach, expect, test } from "bun:test";
import { uploadDebugReport } from "../lib/debug-report-upload";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const id = "550e8400-e29b-41d4-a716-446655440000";
const report = { sessionId: id, ts: 123, metadata: { os: "web", userAgent: "agent", appVersion: "1", environment: "staging", faceAuthPurpose: "selfieEnrollment", flowId: id, result: "success", terminationReason: "success" } };
const body = ` ${JSON.stringify(report)} `;
const request = (text = body) => new Request("https://example.com/api/debug-reports", { method: "POST", body: text });
let tasks: Promise<void>[] = [];
const upload = (text = body, base: URL | undefined = new URL("https://backend.example")) =>
  uploadDebugReport(request(text), "staging", base, task => tasks.push(task));
afterEach(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; tasks = []; });

test("strictly validates the envelope and rejects BOM and oversized bodies", async () => {
  const invalid = ["{", "[]", `\ufeff${body}`, JSON.stringify({ ...report, extra: 1 }), JSON.stringify({ ...report, ts: undefined }),
    JSON.stringify({ ...report, metadata: { ...report.metadata, extra: 1 } }),
    JSON.stringify({ ...report, metadata: { ...report.metadata, environment: "production" } }),
    JSON.stringify({ ...report, metadata: { ...report.metadata, result: "failure", terminationReason: "aborted", PCPFaceCaptureId: id } }),
    JSON.stringify({ ...report, enclaveDebugReport: { status: "unexpected" } }),
    JSON.stringify({ ...report, metadata: { ...report.metadata, result: "failure", terminationReason: ["aborted"] } })];
  for (const value of invalid) expect((await upload(value)).status).toBe(400);
  expect((await upload(" ".repeat(256 * 1024 + 1))).status).toBe(413);
  expect((await uploadDebugReport(request(), "staging", undefined, () => {})).status).toBe(410);
  expect(tasks).toHaveLength(0);
});

test("accepts before forwarding exact bytes and golden SigV4 headers", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bytes = new TextEncoder().encode(body);
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    if (calls === 1) {
      await gate;
      expect(JSON.parse(String(init?.body))).toEqual({ flowId: id, sessionId: id, sha256: new Bun.CryptoHasher("sha256").update(body).digest("hex"), contentLength: bytes.length });
      return Response.json({ url: "https://bucket.example/key?signature=secret", headers: {
        host: ["bucket.example"], "content-length": [String(bytes.length)], "content-type": ["application/json"],
        "x-amz-checksum-sha256": ["checksum"], "x-amz-sdk-checksum-algorithm": ["SHA256"], authorization: ["ignored"],
      } });
    }
    expect(init?.method).toBe("PUT");
    expect(init?.body).toEqual(bytes);
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ "content-type": "application/json", "x-amz-checksum-sha256": "checksum", "x-amz-sdk-checksum-algorithm": "SHA256" });
    return new Response(null);
  }) as unknown as typeof fetch;
  expect((await upload()).status).toBe(202);
  expect(tasks).toHaveLength(1);
  release?.();
  await Promise.all(tasks);
  expect(calls).toBe(2);
});

test("logs upstream statuses and cancels failure bodies", async () => {
  const logs: unknown[] = [];
  console.warn = (...args: unknown[]) => { logs.push(args); };
  for (const failAt of [1, 2]) {
    let calls = 0;
    let cancelled = false;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === failAt) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 429 });
      return Response.json({ url: "https://bucket.example/key", headers: {} });
    }) as unknown as typeof fetch;
    expect((await upload()).status).toBe(202);
    await Promise.all(tasks.splice(0));
    expect(cancelled).toBe(true);
    expect(logs.pop()).toEqual(["debug_report_upload_failed", { dependency: failAt === 1 ? "ai-backend-go" : "s3", status: 429, failureClass: "http_status" }]);
  }
});

test("rejects mismatched presigned content length", async () => {
  const logs: unknown[] = [];
  console.warn = (...args: unknown[]) => { logs.push(args); };
  globalThis.fetch = (async () => Response.json({ url: "https://bucket.example/key", headers: { "content-length": ["1"] } })) as unknown as typeof fetch;
  expect((await upload()).status).toBe(202);
  await Promise.all(tasks);
  expect(logs).toEqual([["debug_report_upload_failed", { dependency: "ai-backend-go", status: 200, failureClass: "request_error" }]]);
});

test("upstream timeouts are driven by the fetch signal", async () => {
  const logs: unknown[] = [];
  console.warn = (...args: unknown[]) => { logs.push(args); };
  for (const failAt of [1, 2]) {
    let calls = 0;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      if (calls === failAt) return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
      return Response.json({ url: "https://bucket.example/key", headers: {} });
    }) as unknown as typeof fetch;
    expect((await upload()).status).toBe(202);
    await Promise.all(tasks.splice(0));
    expect(logs.pop()).toEqual(["debug_report_upload_failed", { dependency: failAt === 1 ? "ai-backend-go" : "s3", status: null, failureClass: "timeout" }]);
  }
}, 15000);


test("maps Bun's body-limit stream error to 413", async () => {
  const error = new Error("limit");
  error.name = "RequestBodyTooLargeError";
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(error); } });
  const request = new Request("https://example.com/api/debug-reports", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  expect((await uploadDebugReport(request, "staging", new URL("https://backend.example"), () => {})).status).toBe(413);
});
