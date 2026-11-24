import { z } from "zod";
import type { DebugReportUploadConfig } from "../../config/environment";
import { SelfieCheckDebugReportSchema, type SelfieCheckDebugReport } from "../../config/selfie-check-debug-report";
import { abortable } from "./async";
import { readBounded } from "./bridge";

const PresignSchema = z.object({ url: z.string(), headers: z.record(z.string(), z.array(z.string()).min(1)) });

export async function uploadDebugReport(report: SelfieCheckDebugReport, config: DebugReportUploadConfig, signal: AbortSignal): Promise<void> {
  let stage: "presign" | "upload" = "presign";
  let status: number | undefined;
  try {
    signal.throwIfAborted();
    const parsed = SelfieCheckDebugReportSchema.parse(report);
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    signal.throwIfAborted();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(3_000)]);
    const response = await fetch(new URL("/api/v1/data/web/report", httpsOrigin(config.apiOrigin)), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: deadline,
      body: JSON.stringify({ flowId: parsed.metadata.flowId, sessionId: parsed.sessionId, sha256, contentLength: bytes.length }),
    });
    if (!response.ok) {
      status = response.status;
      await response.body?.cancel();
      throw new Error("Presign request failed");
    }
    const { url, headers } = parsePresign(
      JSON.parse(await abortable(readBounded(response, 16 * 1024), deadline)), httpsOrigin(config.uploadOrigin), bytes.length,
    );
    stage = "upload";
    signal.throwIfAborted();
    const result = await fetch(url, {
      method: "PUT", headers, body: bytes, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
    });
    await result.body?.cancel();
    if (!result.ok) {
      status = result.status;
      throw new Error("Debug report upload failed");
    }
  } catch {
    if (signal.aborted) return;
    // eslint-disable-next-line no-console -- Presigned URLs and report contents stay out of logs.
    console.warn("selfie_check_debug_upload_failed", { stage, status });
  }
}

function httpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid debug report origin");
  }
  return url.origin;
}

function parsePresign(value: unknown, uploadOrigin: string, length: number) {
  const presigned = PresignSchema.parse(value);
  const url = new URL(presigned.url);
  if (url.protocol !== "https:" || url.origin !== uploadOrigin || url.username || url.password || url.hash) {
    throw new Error("Invalid debug report upload URL");
  }
  const headers = new Headers();
  for (const [name, values] of Object.entries(presigned.headers)) {
    const lower = name.toLowerCase();
    if (lower === "content-length" && (values.length !== 1 || values[0] !== String(length))) {
      throw new Error("Invalid debug report upload length");
    }
    if (lower === "content-type" || lower === "if-none-match" || lower.startsWith("x-amz-")) {
      for (const value of values) headers.append(name, value);
    }
  }
  if (headers.get("if-none-match") !== "*") throw new Error("Debug report upload must be create-only");
  return { url, headers };
}
