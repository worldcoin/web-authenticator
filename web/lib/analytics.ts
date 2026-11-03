import type { CaptureResult, PostHog, PostHogConfig } from "posthog-js";
import type { ConsentState } from "./consent";

export const AnalyticsEvent = {
  selfieCheckDataControlsContinued: "selfie_check_data_controls_continued",
  selfieCaptureStarted: "selfie_capture_started",
  selfieCaptureCompleted: "selfie_capture_completed",
  selfieCaptureFailed: "selfie_capture_failed",
  proofGenerationStarted: "world_id_proof_generation_started",
  proofGenerationCompleted: "world_id_proof_generation_completed",
  proofGenerationFailed: "world_id_proof_generation_failed",
  proofSharingStarted: "world_id_proof_sharing_started",
  proofSharingSuccess: "world_id_proof_sharing_success",
  proofSharingFailed: "world_id_proof_sharing_failed",
} as const;
export type AnalyticsEventName = typeof AnalyticsEvent[keyof typeof AnalyticsEvent];
export type AnalyticsProperties = { duration?: number; reason?: string; n_attempts?: number };
export type AnalyticsConfiguration = { posthogApiKey?: string; posthogFuzzyProxyURL?: string };
const FUZZY_PROXY_ENVIRONMENTS = new Map([
  ["https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture", "staging"],
  ["https://app-backend.sandbox.toolsforhumanity.com/public/v1/posthog/fuzzy-capture", "sandbox"],
  ["https://app-backend.toolsforhumanity.com/public/v1/posthog/fuzzy-capture", "production"],
]);
const eventNames: readonly string[] = Object.values(AnalyticsEvent);
const failureReasons = ["timeout", "cancelled", "permission_denied", "camera_missing", "camera_busy", "unsupported", "invalid_data", "expired", "operation_error"];
const sessionIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Match native fuzzy configuration; the SDK owns transport, retries and lifecycle. */
export function createFuzzyConfiguration(posthogApiKey: string, posthogFuzzyProxyURL: string, hasConsent: () => boolean): Partial<PostHogConfig> {
  return {
    api_host: posthogFuzzyProxyURL,
    autocapture: false, capture_pageview: false, capture_pageleave: false, capture_exceptions: false,
    capture_performance: false, disable_session_recording: true, disable_surveys: true,
    disable_conversations: true, disable_product_tours: true, disable_external_dependency_loading: true,
    advanced_disable_flags: true, advanced_disable_feature_flags: true,
    persistence: "memory", disable_persistence: true, person_profiles: "never",
    save_referrer: false, save_campaign_params: false, ip: false,
    opt_out_capturing_by_default: true,
    // The web SDK wraps even immediate captures in a batch envelope.
    request_batching: false, disable_compression: true, disable_beacon: true, api_transport: "fetch",
    rewriteRequestPath: url => {
      url.pathname = `${new URL(posthogFuzzyProxyURL).pathname}/batch`;
      return url;
    },
    before_send: event => {
      if (!hasConsent() || (event.event !== "$screen" && !eventNames.includes(event.event))) return null;
      const { session_id, duration, reason, n_attempts, $screen_name } = event.properties;
      if (typeof session_id !== "string" || !sessionIDPattern.test(session_id)) return null;
      if (event.event === "$screen" && $screen_name !== "selfie_check_data_controls") return null;
      // Rebuild after SDK enrichment: no URL/query, referrer, account or device properties.
      return {
        event: event.event, uuid: event.uuid, timestamp: event.timestamp,
        properties: {
          token: posthogApiKey, distinct_id: session_id, session_id, source: "web_authenticator", purpose: "faceEnrollment",
          environment: FUZZY_PROXY_ENVIRONMENTS.get(posthogFuzzyProxyURL),
          $process_person_profile: false, $geoip_disable: true,
          ...(typeof duration === "number" && Number.isFinite(duration) && duration >= 0 && duration <= 3_600_000 ? { duration } : {}),
          ...(typeof reason === "string" && failureReasons.includes(reason) ? { reason } : {}),
          ...(typeof n_attempts === "number" && Number.isInteger(n_attempts) && n_attempts >= 1 && n_attempts <= 10_000 ? { n_attempts } : {}),
          ...(event.event === "$screen" ? { $screen_name } : {}),
        },
      };
    },
    on_request_error: response => {
      // eslint-disable-next-line no-console -- Only an operational status, never response/event contents.
      console.warn("analytics_request_failed", { status: response.statusCode });
    },
  };
}

export class PostHogAnalyticsService {
  private postHog?: PostHog;
  private initialization?: Promise<PostHog>;
  private consent = false;
  private sessionID?: string;
  consentRevision = 0;

  constructor(private readonly configuration: AnalyticsConfiguration = {
    posthogApiKey: import.meta.env?.VITE_POSTHOG_API_KEY,
    posthogFuzzyProxyURL: import.meta.env?.VITE_POSTHOG_FUZZY_PROXY_URL,
  }) {}

  get hasConsent() { return this.consent; }

  setConsent(state: ConsentState | null) {
    if (this.consent === (state === "granted")) return;
    this.consent = state === "granted";
    this.consentRevision++;
    this.sessionID = undefined;
    if (!this.consent) this.postHog?.opt_out_capturing();
  }

  startSession() { this.sessionID = undefined; }

  async shutdown() {
    this.setConsent("denied");
    const postHog = this.postHog;
    this.postHog = undefined; this.initialization = undefined;
    await postHog?.shutdown();
  }

  private async initialize(): Promise<PostHog | undefined> {
    const posthogApiKey = this.configuration.posthogApiKey?.trim();
    const posthogFuzzyProxyURL = this.configuration.posthogFuzzyProxyURL?.trim().replace(/\/$/, "");
    if (!posthogApiKey && !posthogFuzzyProxyURL) return;
    if (!posthogApiKey || !posthogFuzzyProxyURL || !FUZZY_PROXY_ENVIRONMENTS.has(posthogFuzzyProxyURL)) {
      throw new Error("analytics_configuration_invalid");
    }
    this.initialization ??= import("posthog-js/no-external").then(({ PostHog }) => {
      const postHog = new PostHog();
      postHog.init(posthogApiKey, createFuzzyConfiguration(posthogApiKey, posthogFuzzyProxyURL, () => this.consent));
      this.postHog = postHog;
      return postHog;
    });
    return this.initialization;
  }

  async track(eventName: AnalyticsEventName | "$screen", properties: AnalyticsProperties & { $screen_name?: string } = {}): Promise<CaptureResult | undefined> {
    if (!this.consent) return;
    const revision = this.consentRevision;
    const sessionID = this.sessionID ??= crypto.randomUUID();
    try {
      const postHog = await this.initialize();
      if (!postHog || !this.consent || revision !== this.consentRevision) return;
      if (!postHog.has_opted_in_capturing()) postHog.opt_in_capturing({ captureEventName: false });
      return postHog.capture(eventName, { ...properties, session_id: sessionID });
    } catch {
      // eslint-disable-next-line no-console -- Analytics failure cannot replace the capture/proof result.
      console.warn("analytics_capture_failed");
      return;
    }
  }
}

export const analyticsService = new PostHogAnalyticsService();
