import { PostHog } from "posthog-node";
import type { AnalyticsEvent } from "../../packages/contracts/src/analytics";

export type AnalyticsSink = (events: AnalyticsEvent[]) => Promise<void>;
const FUZZY_HOSTS = [
  "https://app-backend.toolsforhumanity.com/public/v1/posthog/fuzzy-capture",
  "https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture",
  "https://app-backend.sandbox.toolsforhumanity.com/public/v1/posthog/fuzzy-capture",
];

/** Uses the mobile fuzzy pipeline. Credentials stay server-side; no direct-cloud fallback. */
export function createAnalyticsSink(env: Record<string, string | undefined> = process.env): AnalyticsSink | null {
  const key = env.POSTHOG_FUZZY_KEY?.trim();
  const host = env.POSTHOG_FUZZY_HOST?.trim().replace(/\/$/, "");
  if (!key && !host) return null;
  if (!key || !host || !FUZZY_HOSTS.includes(host) || ![undefined, "v0"].includes(env.POSTHOG_CAPTURE_MODE)) {
    throw new TypeError("analytics_configuration_invalid");
  }
  return async events => {
    // Isolate each request's acknowledgement and retry ownership. No background timers.
    const client = new PostHog(key, {
      host, disableGeoip: true, flushInterval: 0, flushAt: 100, fetchRetryCount: 0, requestTimeout: 4_000,
      disableCompression: true, isServer: false, enableExceptionAutocapture: false,
    });
    for (const event of events) client.capture({
      event: "web_authenticator_step", distinctId: event.flow_id, uuid: event.uuid,
      timestamp: new Date(event.timestamp), disableGeoip: true,
      properties: {
        $process_person_profile: false, $geoip_disable: true, $insert_id: event.uuid,
        surface: "web_authenticator", analytics_version: 1,
        flow_id: event.flow_id, sequence: event.sequence, entry_point: event.entry_point,
        step: event.step, status: event.status, attempt: event.attempt,
        ...(event.duration_ms === undefined ? {} : { duration_ms: event.duration_ms }),
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        ...(event.step === "physical_challenge" ? { challenge: "hold_still" } : {}),
      },
    });
    // captureImmediate swallows network errors in the pinned SDK; flush rejects them.
    // Acknowledge only upstream acceptance. Retries retain every event UUID.
    await client.flush();
  };
}
