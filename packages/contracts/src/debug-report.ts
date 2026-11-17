export type DebugReport = {
  sessionId: string;
  ts: number;
  metadata: DebugReportMetadata;
  enclaveDebugReport?: EnclaveDebugReport;
};

export type DebugReportMetadata = {
  os: "web";
  userAgent: string;
  appVersion: string;
  environment: "staging" | "production";
  faceAuthPurpose: "selfieEnrollment";
  flowId: string;
} & (
  | { result: "success"; terminationReason: "success"; PCPFaceCaptureId?: string }
  | { result: "failure"; terminationReason: "invalid_image" | "quality_rejected" | "extraction_failed" | "enclave_unavailable" | "aborted"; PCPFaceCaptureId?: never }
);

export type EnclaveDebugReport =
  | { status: "available"; report: unknown }
  | { status: "not_produced" }
  | { status: "omitted_too_large"; originalSizeBytes: number }
  | { status: "invalid_json" };

export function isDebugReport(value: unknown, environment: "staging" | "production"): value is DebugReport {
  if (!object(value) || !keys(value, ["sessionId", "ts", "metadata", "enclaveDebugReport"]) ||
      !uuid(value.sessionId) || typeof value.ts !== "number" || !Number.isFinite(value.ts) || !object(value.metadata)) return false;
  const metadata = value.metadata;
  if (!keys(metadata, ["os", "userAgent", "appVersion", "environment", "faceAuthPurpose", "flowId", "result", "terminationReason", "PCPFaceCaptureId"]) ||
      metadata.os !== "web" || typeof metadata.userAgent !== "string" || metadata.userAgent.length > 1024 ||
      typeof metadata.appVersion !== "string" || metadata.appVersion.length > 128 || metadata.environment !== environment ||
      metadata.faceAuthPurpose !== "selfieEnrollment" || !uuid(metadata.flowId)) return false;
  if (metadata.result === "success") {
    if (metadata.terminationReason !== "success" || ("PCPFaceCaptureId" in metadata && !uuid(metadata.PCPFaceCaptureId))) return false;
  } else if (metadata.result === "failure") {
    if ("PCPFaceCaptureId" in metadata || typeof metadata.terminationReason !== "string" || !["invalid_image", "quality_rejected", "extraction_failed", "enclave_unavailable", "aborted"].includes(metadata.terminationReason)) return false;
  } else return false;
  if (!("enclaveDebugReport" in value)) return true;
  const report = value.enclaveDebugReport;
  if (!object(report)) return false;
  switch (report.status) {
    case "available": return keys(report, ["status", "report"]) && "report" in report;
    case "not_produced":
    case "invalid_json": return keys(report, ["status"]);
    case "omitted_too_large": return keys(report, ["status", "originalSizeBytes"]) && typeof report.originalSizeBytes === "number" && Number.isSafeInteger(report.originalSizeBytes) && report.originalSizeBytes >= 0;
    default: return false;
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
