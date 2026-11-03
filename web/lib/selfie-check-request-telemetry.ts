import { AnalyticsEvent, analyticsService, type AnalyticsEventName, type PostHogAnalyticsService } from "./analytics";

export function failureReason(error: unknown): string {
  switch (error instanceof Error ? error.name : "") {
    case "TimeoutError": return "timeout";
    case "AbortError": return "cancelled";
    case "NotAllowedError": case "SecurityError": return "permission_denied";
    case "NotFoundError": case "OverconstrainedError": return "camera_missing";
    case "NotReadableError": return "camera_busy";
    case "NotSupportedError": return "unsupported";
    case "SyntaxError": case "DataError": return "invalid_data";
    default: return "operation_error";
  }
}

/** The request owns milestone timing, as SelfieCheckRequestTelemetry does on iOS. */
export class SelfieCheckRequestTelemetry {
  private requestRevision = 0;
  private observations = new Set<string>();
  private attempts = new Map<string, number>();

  constructor(private readonly analyticsService: PostHogAnalyticsService) {}

  startRequest() {
    this.requestRevision++;
    this.observations.clear(); this.attempts.clear();
    this.analyticsService.startSession();
  }

  consentShown() {
    if (!this.analyticsService.hasConsent || this.observations.has("consentShown")) return;
    this.observations.add("consentShown");
    void this.analyticsService.track("$screen", { $screen_name: "selfie_check_data_controls" });
  }

  consentAccepted() { void this.analyticsService.track(AnalyticsEvent.selfieCheckDataControlsContinued); }

  requestFailed(reason: "expired" | "invalid_data" | "unsupported") {
    if (!this.analyticsService.hasConsent || this.observations.has(reason)) return;
    this.observations.add(reason);
    void this.analyticsService.track(AnalyticsEvent.proofSharingFailed, { reason });
  }

  captureStarted() {
    return this.measure(AnalyticsEvent.selfieCaptureStarted, AnalyticsEvent.selfieCaptureCompleted, AnalyticsEvent.selfieCaptureFailed);
  }

  proofGenerationStarted() {
    return this.measure(AnalyticsEvent.proofGenerationStarted, AnalyticsEvent.proofGenerationCompleted, AnalyticsEvent.proofGenerationFailed);
  }

  deliveryStarted() {
    return this.measure(AnalyticsEvent.proofSharingStarted, AnalyticsEvent.proofSharingSuccess, AnalyticsEvent.proofSharingFailed);
  }

  private measure(started: AnalyticsEventName, succeeded: AnalyticsEventName, failed: AnalyticsEventName) {
    const startedAt = performance.now();
    const requestRevision = this.requestRevision;
    const consentRevision = this.analyticsService.consentRevision;
    const accepted = this.analyticsService.hasConsent;
    const nAttempts = (this.attempts.get(started) ?? 0) + 1;
    if (accepted) {
      this.attempts.set(started, nAttempts);
      void this.analyticsService.track(started, { n_attempts: nAttempts });
    }
    let finished = false;
    const complete = (eventName: AnalyticsEventName, error?: unknown) => {
      if (finished) return;
      finished = true;
      if (!accepted || requestRevision !== this.requestRevision || consentRevision !== this.analyticsService.consentRevision) return;
      const duration = Math.min(3_600_000, Math.max(0, Math.round(performance.now() - startedAt)));
      void this.analyticsService.track(eventName, { duration, n_attempts: nAttempts, ...(error === undefined ? {} : { reason: failureReason(error) }) });
    };
    return { succeeded: () => complete(succeeded), failed: (error: unknown) => complete(failed, error) };
  }
}

export const selfieCheckRequestTelemetry = new SelfieCheckRequestTelemetry(analyticsService);
