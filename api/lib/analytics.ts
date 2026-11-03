import type { AnalyticsEvent } from "../../packages/contracts/src/analytics";

export type AnalyticsSink = (events: AnalyticsEvent[]) => Promise<void>;
const FUZZY_HOSTS = [
  "https://app-backend.toolsforhumanity.com/public/v1/posthog/fuzzy-capture",
  "https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture",
  "https://app-backend.sandbox.toolsforhumanity.com/public/v1/posthog/fuzzy-capture",
];

/** The existing mobile /batch transport; no SDK, browser identity or automatic properties. */
export function createAnalyticsSink(env: Record<string, string | undefined> = process.env): AnalyticsSink | null {
  const key = env.POSTHOG_FUZZY_KEY?.trim();
  const host = env.POSTHOG_FUZZY_HOST?.trim().replace(/\/$/, "");
  if (!key && !host) return null;
  if (!key || !host || !FUZZY_HOSTS.includes(host)) throw new TypeError("analytics_configuration_invalid");
  const environment = host === FUZZY_HOSTS[0] ? "production" : host === FUZZY_HOSTS[1] ? "staging" : "sandbox";
  return async events => {
    const response = await fetch(`${host}/batch/`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(4_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        batch: events.map(event => ({
          event: "web_authenticator_step", distinct_id: event.flow_id, uuid: event.uuid, timestamp: event.timestamp,
          properties: {
            $process_person_profile: false, $geoip_disable: true, $is_identified: false, $insert_id: event.uuid,
            surface: "web_authenticator", environment, analytics_version: 1,
            flow_id: event.flow_id, sequence: event.sequence, step: event.step, status: event.status, attempt: event.attempt,
            ...(event.duration_ms === undefined ? {} : { duration_ms: event.duration_ms }),
            ...(event.reason === undefined ? {} : { reason: event.reason }),
          },
        })),
      }),
    });
    // Upstream bodies can contain sensitive data and are never read or logged.
    await response.body?.cancel();
    if (!response.ok) {
      // eslint-disable-next-line no-console -- Safe upstream status, never the response body.
      console.warn("analytics_upstream_rejected", { status: response.status });
      throw new Error("analytics_upstream_rejected");
    }
  };
}
