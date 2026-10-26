import { afterEach, expect, spyOn, test } from "bun:test";
import { createAnalyticsSink } from "../lib/analytics";
import { createAnalyticsHandler } from "../routes/api/analytics";
import type { AnalyticsEvent } from "../../packages/contracts/src/analytics";

const event = (): AnalyticsEvent => ({
  uuid: crypto.randomUUID(), flow_id: crypto.randomUUID(), sequence: 1, timestamp: new Date().toISOString(),
  step: "physical_challenge", status: "completed", entry_point: "deeplink", attempt: 1, duration_ms: 1500,
});
const request = (body: unknown = [event()], headers: Record<string, string> = {}) => new Request("https://auth.example/api/analytics", {
  method: "POST", body: JSON.stringify(body), headers: {
    "content-type": "application/json", "sec-fetch-site": "same-origin", origin: "https://auth.example",
    cookie: "__Host-wid_consent=v1.granted", ...headers,
  },
});
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

test("enforces server consent, version, GPC and same-origin before calling the sink", async () => {
  let calls = 0; const handler = createAnalyticsHandler(async () => { calls++; });
  const forbidden: Record<string, string>[] = [
    { cookie: "" }, { cookie: "__Host-wid_consent=v1.denied" }, { cookie: "__Host-wid_consent=v0.granted" },
    { cookie: "", "sec-gpc": "1" }, { origin: "https://evil.example" }, { origin: "" },
    { "sec-fetch-site": "same-site" }, { "content-type": "text/plain" },
  ];
  for (const headers of forbidden) expect((await handler(request([event()], headers))).status).toBe(403);
  expect(calls).toBe(0);
  expect((await handler(request())).status).toBe(204); expect(calls).toBe(1);
});

test("rejects arbitrary payloads, unknown properties, oversized bodies and batches", async () => {
  let calls = 0; const handler = createAnalyticsHandler(async () => { calls++; });
  for (const body of [null, [], {}, [null], [{ ...event(), image: "secret" }], Array.from({ length: 17 }, event)]) {
    expect((await handler(request(body))).status).toBe(400);
  }
  expect((await handler(request([{ ...event(), proof: "x".repeat(16_384) }]))).status).toBe(413);
  expect(calls).toBe(0);
});

test("acknowledges only upstream acceptance and bounds concurrent requests", async () => {
  const replies: (() => void)[] = [];
  const handler = createAnalyticsHandler(() => new Promise(resolve => replies.push(resolve)));
  const pending = Array.from({ length: 4 }, () => handler(request()));
  expect((await handler(request())).status).toBe(429);
  await new Promise(resolve => setTimeout(resolve, 0));
  replies.forEach(resolve => resolve());
  expect((await Promise.all(pending)).every(response => response.status === 204)).toBe(true);
  const failing = createAnalyticsHandler(async () => { throw new Error("private upstream response"); });
  const response = await failing(request());
  expect(response.status).toBe(503); expect(await response.text()).toBe("");
});

test("disabled by default; refuses partial configuration or a non-mobile destination", async () => {
  expect(createAnalyticsSink({})).toBeNull();
  expect((await createAnalyticsHandler(null)(request())).status).toBe(204);
  expect(() => createAnalyticsSink({ POSTHOG_FUZZY_KEY: "test" })).toThrow("analytics_configuration_invalid");
  expect(() => createAnalyticsSink({ POSTHOG_FUZZY_KEY: "test", POSTHOG_FUZZY_HOST: "https://us.i.posthog.com" })).toThrow();
});

test("real PostHog SDK sends anonymous allowlisted events to the mobile batch endpoint with stable deduplication IDs", async () => {
  const bodies: unknown[] = []; const urls: string[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
    urls.push(String(url)); bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ status: 1 });
  }) as typeof fetch); restore = () => mock.mockRestore();
  const host = "https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture";
  const sink = createAnalyticsSink({ POSTHOG_FUZZY_KEY: "test-token", POSTHOG_FUZZY_HOST: host })!;
  const e = event(); await sink([e]); await sink([e]);
  expect(urls).toEqual([`${host}/batch/`, `${host}/batch/`]);
  const wire = bodies[0] as { api_key: string; batch: { uuid: string; distinct_id: string; event: string; properties: Record<string, unknown> }[] };
  expect(wire.api_key).toBe("test-token");
  expect(wire.batch[0]).toMatchObject({ uuid: e.uuid, distinct_id: e.flow_id, event: "web_authenticator_step" });
  expect(wire.batch[0]?.properties).toMatchObject({
    $process_person_profile: false, $geoip_disable: true, $insert_id: e.uuid,
    step: "physical_challenge", challenge: "hold_still", surface: "web_authenticator",
  });
  for (const key of ["$current_url", "$referrer", "$ip", "$set", "$set_once"]) {
    expect(wire.batch[0]?.properties).not.toHaveProperty(key);
  }
  expect((bodies[1] as typeof wire).batch[0]?.uuid).toBe(e.uuid);
});

test("PostHog SDK network and HTTP failures propagate to the browser retry queue", async () => {
  let failNetwork = false;
  const mock = spyOn(globalThis, "fetch").mockImplementation((async (_url: RequestInfo | URL) => {
    if (failNetwork) throw new TypeError("private connection details");
    return new Response("private upstream body", { status: 503 });
  }) as typeof fetch); restore = () => mock.mockRestore();
  const sink = createAnalyticsSink({ POSTHOG_FUZZY_KEY: "test-token", POSTHOG_FUZZY_HOST: "https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture" })!;
  const handler = createAnalyticsHandler(sink);
  expect((await handler(request())).status).toBe(503);
  failNetwork = true;
  expect((await handler(request())).status).toBe(503);
  expect(mock).toHaveBeenCalledTimes(2);
});
