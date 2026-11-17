import { isDebugReport, type DebugReport } from "../../packages/contracts/src/debug-report";
import { BodyTooLargeError, readBoundedBytes } from "../../packages/shared/read-bounded";
import type { ProtocolEnvironment } from "../../config/environment";

export const DEBUG_REPORT_LIMIT = 256 * 1024;
const TIMEOUT_MS = 5000;

export async function uploadDebugReport(request: Request, environment: ProtocolEnvironment, baseUrl: URL | undefined,
  schedule: (task: Promise<void>) => void): Promise<Response> {
  if (!baseUrl) return Response.json({ code: "debug_reports_disabled" }, { status: 410 });
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBoundedBytes(request.body, DEBUG_REPORT_LIMIT);
  } catch (error) {
    return Response.json({ error: isBodyLimitError(error) ? "Report too large" : "Invalid report" }, { status: isBodyLimitError(error) ? 413 : 400 });
  }
  let report: unknown;
  try {
    report = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return Response.json({ error: "Invalid report" }, { status: 400 });
  }
  if (!isDebugReport(report, environment)) return Response.json({ error: "Invalid report" }, { status: 400 });
  schedule(forwardReport(baseUrl, report, bytes));
  return new Response(null, { status: 202 });
}

async function forwardReport(baseUrl: URL, report: DebugReport, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  let dependency: "ai-backend-go" | "s3" = "ai-backend-go";
  let status: number | null = null;
  let signal: AbortSignal | undefined;
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetch(new URL("/api/v1/data/web/report", baseUrl), {
      method: "POST", headers: { "content-type": "application/json" }, redirect: "error", signal,
      body: JSON.stringify({ flowId: report.metadata.flowId, sessionId: report.sessionId, sha256, contentLength: bytes.length }),
    });
    status = response.status;
    let presigned: { url: string; headers: Headers };
    try {
      if (!response.ok) throw new Error("upstream_status");
      const body = await readBoundedBytes(response.body, DEBUG_REPORT_LIMIT);
      presigned = parsePresigned(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body)), bytes.length);
    } finally {
      await response.body?.cancel();
    }
    dependency = "s3";
    status = null;
    signal = AbortSignal.timeout(TIMEOUT_MS);
    const upload = await fetch(presigned.url, { method: "PUT", headers: presigned.headers, body: bytes, redirect: "error", signal });
    status = upload.status;
    try {
      if (!upload.ok) throw new Error("upstream_status");
    } finally {
      await upload.body?.cancel();
    }
  } catch {
    const failureClass = signal?.aborted ? "timeout" : status !== null && (status < 200 || status >= 300) ? "http_status" : "request_error";
    // eslint-disable-next-line no-console -- No report data or presigned URL is logged.
    console.warn("debug_report_upload_failed", { dependency, status, failureClass });
  }
}

function parsePresigned(value: unknown, length: number): { url: string; headers: Headers } {
  if (!object(value) || typeof value.url !== "string" || !object(value.headers)) throw new Error("invalid_presign_response");
  const url = new URL(value.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_presign_url");
  const headers = new Headers();
  for (const [name, values] of Object.entries(value.headers)) {
    if (!Array.isArray(values) || values.length === 0 || !values.every(item => typeof item === "string")) throw new Error("invalid_presign_headers");
    const lower = name.toLowerCase();
    if (lower === "content-length" && (values.length !== 1 || values[0] !== String(length))) throw new Error("invalid_content_length");
    if (lower === "content-type" || lower.startsWith("x-amz-")) for (const item of values) headers.append(name, item);
  }
  return { url: url.toString(), headers };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBodyLimitError(error: unknown): boolean {
  return error instanceof BodyTooLargeError || (error instanceof Error && error.name === "RequestBodyTooLargeError");
}
