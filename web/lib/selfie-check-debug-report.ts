import { ENVIRONMENTS } from "../../config/environment";
import {
  MAX_DEBUG_MILESTONES,
  type DiagnosticMilestone, type DiagnosticOutcome, type DiagnosticStage, type SelfieCheckDebugReport,
} from "../../config/selfie-check-debug-report";
import type { ConsentState } from "./consent";
import { uploadDebugReport } from "./debug-report";
import { RequestExpiredError } from "./proof-request";

type RequestEnvironment = SelfieCheckDebugReport["metadata"]["environment"];

export type SelfieCheckDiagnosticAttempt = {
  readonly finished: boolean;
  enter: (stage: DiagnosticStage) => void;
  finish: (outcome?: DiagnosticOutcome) => void;
  fail: (error: unknown) => void;
};

export function createSelfieCheckDiagnostics(upload = uploadConfiguredReport) {
  let consent: AbortController | undefined;
  return {
    setConsent(state: ConsentState) {
      if (state === "granted") consent ??= new AbortController();
      else {
        consent?.abort();
        consent = undefined;
      }
    },
    forRequest(environment: RequestEnvironment) {
      let flowId: string | undefined;
      return (stage: DiagnosticStage): SelfieCheckDiagnosticAttempt | undefined => {
        if (!consent) return;
        try {
          flowId ??= crypto.randomUUID();
          return createAttempt(flowId, environment, stage, consent.signal, upload);
        } catch {
          reportFailure();
        }
      };
    },
  };
}

function createAttempt(
  flowId: string, environment: RequestEnvironment, initialStage: DiagnosticStage,
  signal: AbortSignal, upload: typeof uploadConfiguredReport,
): SelfieCheckDiagnosticAttempt {
  const sessionId = crypto.randomUUID();
  const started = performance.now();
  let stage = initialStage;
  let finished = false;
  let milestones: DiagnosticMilestone[] = [{ stage, elapsedMs: 0 }];
  const discard = () => finish();
  signal.addEventListener("abort", discard, { once: true });

  return {
    get finished() { return finished; },
    enter(next) {
      if (finished || next === stage) return;
      stage = next;
      if (milestones.length === MAX_DEBUG_MILESTONES) milestones.shift();
      milestones.push({ stage, elapsedMs: elapsed() });
    },
    finish,
    fail(error) { finish(failureOutcome(error, stage)); },
  };

  function finish(outcome?: DiagnosticOutcome) {
    if (finished) return;
    finished = true;
    signal.removeEventListener("abort", discard);
    const recent = milestones;
    milestones = [];
    if (!outcome || signal.aborted) return;
    const report: SelfieCheckDebugReport = {
      sessionId,
      ts: Date.now(),
      metadata: { schemaVersion: 1, os: "web", flowId, environment, stage, elapsedMs: elapsed(), outcome, milestones: recent },
    };
    void Promise.resolve().then(() => {
      if (!signal.aborted) return upload(report, signal);
    }).catch(() => {
      if (!signal.aborted) reportFailure();
    });
  }

  function elapsed() {
    return Math.round(performance.now() - started);
  }
}

function failureOutcome(error: unknown, stage: DiagnosticStage): DiagnosticOutcome {
  if (error instanceof RequestExpiredError) return { type: "expired", reason: "request_expired" };
  const name = error instanceof Error ? error.name : undefined;
  switch (name) {
    case "TimeoutError": return { type: "failed", reason: "timeout" };
    case "NotAllowedError": return { type: "failed", reason: stage === "passkey" ? "passkey_not_allowed" : "permission_denied" };
    case "NotFoundError":
    case "NotReadableError": return { type: "failed", reason: "device_unavailable" };
    case "AbortError": return { type: "failed", reason: "aborted" };
    default: return { type: "failed", reason: "operation_failed" };
  }
}

async function uploadConfiguredReport(report: SelfieCheckDebugReport, signal: AbortSignal) {
  const environment = report.metadata.environment === "production" ? "production" : "staging";
  const config = ENVIRONMENTS[environment].debugReports;
  if (config) await uploadDebugReport(report, config, signal);
}

function reportFailure() {
  // eslint-disable-next-line no-console -- Report collection failures without attaching input or exception details.
  console.warn("selfie_check_debug_report_failed");
}
