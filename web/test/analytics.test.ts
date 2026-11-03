import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { waitFor } from "@testing-library/react";
import { AnalyticsEvent, createFuzzyConfiguration, PostHogAnalyticsService } from "../lib/analytics";
import { SelfieCheckRequestTelemetry, failureReason } from "../lib/selfie-check-request-telemetry";

const host = "https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture";
const services: PostHogAnalyticsService[] = [];
let restore: (() => void) | undefined;
beforeAll(() => {
  GlobalRegistrator.register({ url: "https://auth.example/verify?k=PRIVATE-BRIDGE-KEY" });
  // The real SDK intentionally ignores HappyDOM's bot user agent.
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" });
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
});
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.shutdown()));
  restore?.(); restore = undefined;
});
afterAll(() => GlobalRegistrator.unregister());

test("real web SDK sends native-compatible JSON directly to /batch, with no automatic or private properties", async () => {
  type Envelope = { api_key: string; batch: { event: string; properties: Record<string, unknown> }[] };
  const requests: { url: string; init: RequestInit; body: Envelope }[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
    requests.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) });
    return Response.json({ status: 1 });
  }) as typeof fetch);
  restore = () => mock.mockRestore();
  const service = new PostHogAnalyticsService({ posthogApiKey: "test-project-token", posthogFuzzyProxyURL: host });
  services.push(service);
  expect(await service.track(AnalyticsEvent.selfieCaptureStarted)).toBeUndefined();
  expect(requests).toEqual([]);
  service.setConsent("granted");
  await service.track(AnalyticsEvent.selfieCaptureStarted, { n_attempts: 1 });
  await service.track(AnalyticsEvent.selfieCaptureCompleted, { duration: 1500, n_attempts: 1 });
  await waitFor(() => expect(requests).toHaveLength(2));
  const first = requests[0]!;
  expect(new URL(first.url).pathname).toBe("/public/v1/posthog/fuzzy-capture/batch");
  expect(new URL(first.url).origin).toBe(new URL(host).origin);
  expect(new Headers(first.init.headers).get("content-type")).toBe("application/json");
  expect(first.body.api_key).toBe("test-project-token");
  expect(first.body.batch).toHaveLength(1);
  expect(first.body.batch[0]?.event).toBe("selfie_capture_started");
  const properties = first.body.batch[0]!.properties;
  expect(properties.source).toBe("web_authenticator");
  expect(properties.environment).toBe("staging");
  expect(properties.session_id).toBe(properties.distinct_id);
  expect(requests[1]?.body.batch[0]?.properties).toMatchObject({ session_id: properties.session_id, duration: 1500, n_attempts: 1 });
  expect(JSON.stringify(requests.map(request => request.body))).not.toContain("PRIVATE");
  expect(properties.token).toBe("test-project-token");
  for (const key of ["$current_url", "$referrer", "$device_id", "$raw_user_agent", "$set", "$set_once"]) {
    expect(properties).not.toHaveProperty(key);
    expect(first.body.batch[0]).not.toHaveProperty(key);
  }
  service.setConsent("denied");
  await service.track(AnalyticsEvent.proofSharingSuccess);
  expect(requests).toHaveLength(2);
  service.setConsent("granted");
  await service.track(AnalyticsEvent.selfieCaptureStarted);
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]!.body.batch[0]?.properties.session_id).not.toBe(properties.session_id);
});

test("SDK before_send rejects automatic events and untrusted identity/error properties", () => {
  let granted = true;
  const config = createFuzzyConfiguration("test-project-token", host, () => granted);
  const beforeSend = config.before_send;
  if (typeof beforeSend !== "function") throw new Error("Expected one before_send filter");
  const event = {
    event: AnalyticsEvent.selfieCaptureFailed, uuid: crypto.randomUUID(), timestamp: new Date(),
    properties: { session_id: crypto.randomUUID(), reason: "PRIVATE-ERROR", image: "PRIVATE-PHOTO", $current_url: "https://auth.example/?k=PRIVATE-KEY" },
  };
  const filtered = beforeSend(event);
  expect(filtered).not.toBeNull();
  expect(JSON.stringify(filtered)).not.toContain("PRIVATE");
  expect(beforeSend({ ...event, event: "$pageview" })).toBeNull();
  expect(beforeSend({ ...event, properties: { session_id: "account-identifier" } })).toBeNull();
  granted = false;
  expect(beforeSend(event)).toBeNull();
});

test("deployment destination determines environment, overriding caller properties", () => {
  for (const [url, environment] of [
    [host, "staging"],
    ["https://app-backend.sandbox.toolsforhumanity.com/public/v1/posthog/fuzzy-capture", "sandbox"],
    ["https://app-backend.toolsforhumanity.com/public/v1/posthog/fuzzy-capture", "production"],
  ] as const) {
    const beforeSend = createFuzzyConfiguration("test-project-token", url, () => true).before_send;
    if (typeof beforeSend !== "function") throw new Error("Expected one before_send filter");
    const result = beforeSend({
      event: AnalyticsEvent.selfieCaptureCompleted, uuid: crypto.randomUUID(), timestamp: new Date(),
      properties: { session_id: crypto.randomUUID(), environment: "caller-controlled" },
    });
    expect(result?.properties.environment).toBe(environment);
  }
});

test("request telemetry pairs outcomes and attempts without replaying pre-consent or stale completions", () => {
  const service = new PostHogAnalyticsService({});
  const events: { eventName: string; duration?: number; reason?: string; n_attempts?: number }[] = [];
  const track = spyOn(service, "track").mockImplementation(async (eventName, properties) => {
    events.push({ eventName, ...properties }); return undefined;
  });
  restore = () => track.mockRestore();
  const telemetry = new SelfieCheckRequestTelemetry(service);
  const beforeConsent = telemetry.captureStarted();
  service.setConsent("granted"); beforeConsent.succeeded();
  expect(events).toEqual([]);
  telemetry.startRequest(); telemetry.consentShown(); telemetry.consentShown(); telemetry.consentAccepted();
  const first = telemetry.captureStarted();
  first.failed(new DOMException("PRIVATE-ERROR", "TimeoutError")); first.succeeded();
  const second = telemetry.captureStarted(); second.succeeded();
  expect(events.map(event => event.eventName)).toEqual([
    "$screen", "selfie_check_data_controls_continued", "selfie_capture_started", "selfie_capture_failed", "selfie_capture_started", "selfie_capture_completed",
  ]);
  expect(events.at(-1)?.n_attempts).toBe(2);
  expect(events.at(-1)?.duration).toBeGreaterThanOrEqual(0);
  const pending = telemetry.deliveryStarted();
  service.setConsent("denied"); service.setConsent("granted");
  pending.succeeded();
  expect(events.at(-1)?.eventName).toBe("world_id_proof_sharing_started");
  const oldRequest = telemetry.captureStarted(); telemetry.startRequest(); oldRequest.succeeded();
  expect(events.at(-1)?.eventName).toBe("selfie_capture_started");
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
  expect(failureReason(new DOMException("private", "NotAllowedError"))).toBe("permission_denied");
});

test("absent configuration is disabled; partial/unapproved configuration cannot contact arbitrary hosts", async () => {
  const missing = new PostHogAnalyticsService({});
  missing.setConsent("granted");
  expect(await missing.track(AnalyticsEvent.selfieCaptureStarted)).toBeUndefined();
  const mock = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected remote call"));
  restore = () => mock.mockRestore();
  for (const configuration of [{ posthogApiKey: "test" }, { posthogApiKey: "test", posthogFuzzyProxyURL: "https://untrusted.example" }]) {
    const service = new PostHogAnalyticsService(configuration);
    service.setConsent("granted");
    expect(await service.track(AnalyticsEvent.selfieCaptureStarted)).toBeUndefined();
  }
  expect(mock).not.toHaveBeenCalled();
});
