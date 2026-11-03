import { afterEach, expect, spyOn, test } from "bun:test";
import { createAnalyticsSink } from "../lib/analytics";
import { createAnalyticsHandler } from "../routes/api/analytics";
import type { AnalyticsEvent } from "../../packages/contracts/src/analytics";

const event = (): AnalyticsEvent => ({
  uuid: crypto.randomUUID(), flow_id: crypto.randomUUID(), sequence: 1, timestamp: new Date().toISOString(),
  step: "selfie_capture", status: "completed", attempt: 1, duration_ms: 1500,
});
const headers = {
  "content-type": "application/json", "sec-fetch-site": "same-origin", origin: "https://auth.example",
  "x-analytics-consent": "v1.granted",
};
const request = (body: unknown = [event()], overrides: Record<string, string> = {}) => new Request("https://auth.example/api/analytics", {
  method: "POST", body: JSON.stringify(body), headers: { ...headers, ...overrides },
});
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

test("requires a versioned consent declaration and same-origin JSON on every batch", async () => {
  let calls = 0;
  const handler = createAnalyticsHandler(async () => { calls++; });
  const forbidden: Record<string, string>[] = [
    { "x-analytics-consent": "" }, { "x-analytics-consent": "v1.denied" }, { "x-analytics-consent": "v0.granted" },
    { origin: "https://evil.example" }, { origin: "" }, { "sec-fetch-site": "same-site" }, { "content-type": "text/plain" },
  ];
  for (const overrides of forbidden) expect((await handler(request([event()], overrides))).status).toBe(403);
  expect(calls).toBe(0);
  expect((await handler(request())).status).toBe(204);
  expect(calls).toBe(1);
});

test("rejects private fields, unsupported milestones, invalid dates and oversized batches before forwarding", async () => {
  let calls = 0;
  const handler = createAnalyticsHandler(async () => { calls++; });
  for (const body of [
    null, [], {}, [null], [{ ...event(), image: "private" }], [{ ...event(), reason: "private exception" }],
    [{ ...event(), step: "credential_issuance" }], [{ ...event(), step: "physical_challenge" }],
    [{ ...event(), timestamp: "2026-02-30T00:00:00.000Z" }], Array.from({ length: 17 }, event),
  ]) expect((await handler(request(body))).status).toBe(400);
  expect((await handler(request([{ ...event(), proof: "x".repeat(16_384) }]))).status).toBe(413);
  expect(calls).toBe(0);
});

test("acknowledges upstream acceptance, propagates failures, and bounds concurrent bodies and forwarding", async () => {
  const replies: (() => void)[] = [];
  const handler = createAnalyticsHandler(() => new Promise(resolve => replies.push(resolve)));
  const pending = Array.from({ length: 4 }, () => handler(request()));
  expect((await handler(request())).status).toBe(429);
  await new Promise(resolve => setTimeout(resolve, 0));
  replies.forEach(resolve => resolve());
  expect((await Promise.all(pending)).every(response => response.status === 204)).toBe(true);
  const failing = createAnalyticsHandler(async () => { throw new Error("private upstream contents"); });
  const response = await failing(request());
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("");
  const retry = handler(request());
  await new Promise(resolve => setTimeout(resolve, 0));
  replies.at(-1)!();
  expect((await retry).status).toBe(204);
});

test("times out a stalled body and releases its admission slot", async () => {
  let cancelled = false;
  const handler = createAnalyticsHandler(null);
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const response = await handler(new Request("https://auth.example/api/analytics", { method: "POST", headers, body }));
  expect(response.status).toBe(408);
  expect(cancelled).toBe(true);
  expect((await handler(request())).status).toBe(204);
});

test("disabled by default; invalid or partial configuration cannot send to arbitrary destinations", async () => {
  expect(createAnalyticsSink({})).toBeNull();
  expect((await createAnalyticsHandler(null)(request())).status).toBe(204);
  expect((await createAnalyticsHandler(null)(request([{ ...event(), secret: "private" }]))).status).toBe(400);
  expect(() => createAnalyticsSink({ POSTHOG_FUZZY_KEY: "test" })).toThrow("analytics_configuration_invalid");
  expect(() => createAnalyticsSink({ POSTHOG_FUZZY_KEY: "test", POSTHOG_FUZZY_HOST: "https://untrusted.example" })).toThrow();
});

test("forwards only explicit anonymous properties and preserves event IDs across retries", async () => {
  const bodies: unknown[] = [];
  const requests: RequestInit[] = [];
  const host = "https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture";
  const mock = spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
    expect(String(url)).toBe(`${host}/batch/`);
    bodies.push(JSON.parse(String(init?.body))); requests.push(init!);
    return Response.json({ status: 1 });
  }) as typeof fetch);
  restore = () => mock.mockRestore();
  const sink = createAnalyticsSink({ POSTHOG_FUZZY_KEY: "test-token", POSTHOG_FUZZY_HOST: host })!;
  const e = event();
  await sink([e]); await sink([e]);
  const wire = bodies[0] as { api_key: string; batch: { uuid: string; distinct_id: string; event: string; properties: Record<string, unknown> }[] };
  expect(wire.api_key).toBe("test-token");
  expect(wire.batch[0]).toMatchObject({ uuid: e.uuid, distinct_id: e.flow_id, event: "web_authenticator_step" });
  expect(wire.batch[0]?.properties).toEqual({
    $process_person_profile: false, $geoip_disable: true, $is_identified: false, $insert_id: e.uuid,
    surface: "web_authenticator", environment: "staging", analytics_version: 1,
    flow_id: e.flow_id, sequence: e.sequence, step: "selfie_capture", status: "completed", attempt: 1, duration_ms: 1500,
  });
  expect(bodies[1]).toEqual(bodies[0]);
  expect(requests[0]?.redirect).toBe("error");
  expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
  expect(requests[0]?.headers).toEqual({ "Content-Type": "application/json" });
});

test("HTTP and network failures are surfaced without forwarding their contents to the browser", async () => {
  let networkFailure = false;
  const mock = spyOn(globalThis, "fetch").mockImplementation((async (_url: RequestInfo | URL) => {
    if (networkFailure) throw new TypeError("private connection details");
    return new Response("private upstream body", { status: 503 });
  }) as typeof fetch);
  restore = () => mock.mockRestore();
  const sink = createAnalyticsSink({ POSTHOG_FUZZY_KEY: "test-token", POSTHOG_FUZZY_HOST: "https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture" })!;
  const handler = createAnalyticsHandler(sink);
  expect((await handler(request())).status).toBe(503);
  networkFailure = true;
  const response = await handler(request());
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("");
  expect(mock).toHaveBeenCalledTimes(2);
});
