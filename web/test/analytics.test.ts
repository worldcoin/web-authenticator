import { afterEach, expect, test } from "bun:test";
import { FlowAnalytics, analyticsReason } from "../lib/analytics";
import { isAnalyticsEvent, type AnalyticsEvent } from "../../packages/contracts/src/analytics";

const clients: FlowAnalytics[] = [];
afterEach(() => { clients.forEach(client => client.setConsent("denied")); clients.length = 0; });
function fixture(status = 204) {
  const batches: AnalyticsEvent[][] = [];
  const requests: RequestInit[] = [];
  const client = new FlowAnalytics((async (_url, init) => {
    requests.push(init!); batches.push(JSON.parse(String(init?.body)));
    return new Response(null, { status });
  }) as typeof fetch);
  clients.push(client);
  return { client, batches, requests };
}

test("collects nothing before consent, on denial, or retroactively after grant", async () => {
  const { client, batches } = fixture();
  const finish = client.begin("selfie_capture");
  client.once("request", "started");
  client.setConsent("denied");
  client.record("camera", "completed");
  await client.flush();
  expect(batches).toEqual([]);
  client.setConsent("granted", "deeplink");
  finish("completed");
  client.once("request", "started");
  await client.flush();
  expect(batches.flat().map(e => [e.step, e.status, e.entry_point])).toEqual([["request", "started", "deeplink"]]);
});

test("one terminal outcome per attempt, retries get new attempt numbers, rerenders do not duplicate milestones", async () => {
  const { client, batches } = fixture(); client.setConsent("granted");
  client.once("request", "completed"); client.once("request", "completed");
  const first = client.begin("selfie_capture");
  first("failed", "timeout"); first("completed");
  const second = client.begin("selfie_capture"); second("completed"); second("cancelled");
  await client.flush();
  const events = batches.flat();
  expect(events.map(e => [e.step, e.status, e.attempt])).toEqual([
    ["request", "completed", 0], ["selfie_capture", "started", 1], ["selfie_capture", "failed", 1],
    ["selfie_capture", "started", 2], ["selfie_capture", "completed", 2],
  ]);
  expect(new Set(events.map(e => e.flow_id)).size).toBe(1);
  expect(events.map(e => e.sequence)).toEqual([1, 2, 3, 4, 5]);
});

test("transient failures retain IDs and timestamps; retry budget and queue are bounded", async () => {
  const { client, batches } = fixture(503); client.setConsent("granted");
  client.record("proof_delivery", "completed");
  for (let i = 0; i < 5; i++) await client.flush();
  expect(batches).toHaveLength(4);
  expect(batches.every(batch => JSON.stringify(batch) === JSON.stringify(batches[0]))).toBe(true);
  const good = fixture(); good.client.setConsent("granted");
  for (let i = 0; i < 200; i++) good.client.record("camera", "started");
  for (let i = 0; i < 10; i++) await good.client.flush();
  expect(good.batches.flat()).toHaveLength(128);
  expect(good.batches.every(batch => batch.length <= 16)).toBe(true);
});

test("revocation erases queued events, rotates identity, and suppresses old asynchronous completions", async () => {
  const { client, batches } = fixture(); client.setConsent("granted");
  const finish = client.begin("proof_generation"); await client.flush();
  client.record("camera", "started"); client.setConsent("denied");
  await client.flush();
  expect(batches).toHaveLength(1);
  client.setConsent("granted"); finish("completed");
  client.record("camera", "started"); await client.flush();
  expect(batches[1]).toHaveLength(1);
  expect(batches[1]![0]!.flow_id).not.toBe(batches[0]![0]!.flow_id);
});

test("revocation aborts pending sends and a stale response cannot erase new events", async () => {
  const requests: RequestInit[] = []; const replies: ((response: Response) => void)[] = [];
  const client = new FlowAnalytics(((_url, init) => { requests.push(init!); return new Promise(resolve => replies.push(resolve)); }) as typeof fetch);
  clients.push(client); client.setConsent("granted");
  client.record("camera", "started"); const first = client.flush();
  client.setConsent("denied"); expect(requests[0]?.signal?.aborted).toBe(true);
  client.setConsent("granted"); client.record("camera", "completed");
  replies[0]!(new Response(null, { status: 204 })); await first;
  const second = client.flush();
  expect(JSON.parse(String(requests[1]?.body))[0].status).toBe("completed");
  replies[1]!(new Response(null, { status: 204 })); await second;
});

test("page-exit delivery uses keepalive and preserves the ID of an in-flight event", async () => {
  const requests: RequestInit[] = []; const replies: ((response: Response) => void)[] = [];
  const client = new FlowAnalytics(((_url, init) => { requests.push(init!); return new Promise(resolve => replies.push(resolve)); }) as typeof fetch);
  clients.push(client); client.setConsent("granted"); client.record("proof_delivery", "completed");
  const ordinary = client.flush(); const leaving = client.flush(true);
  expect(requests[1]?.keepalive).toBe(true);
  expect(requests[1]?.body).toBe(requests[0]?.body);
  expect(requests[1]?.referrerPolicy).toBe("no-referrer");
  replies.forEach(resolve => resolve(new Response(null, { status: 204 })));
  await Promise.all([ordinary, leaving]);
});

test("server-side consent rejection disables collection", async () => {
  const { client, batches } = fixture(403); client.setConsent("granted"); client.record("camera", "started");
  await client.flush(); client.record("camera", "completed"); await client.flush();
  expect(batches).toHaveLength(1);
});

test("exit flushing prioritizes terminal results and includes asynchronously cancelled attempts", async () => {
  const { client, batches, requests } = fixture(); client.setConsent("granted");
  for (let i = 0; i < 20; i++) client.record("registration_poll", "completed");
  client.record("proof_delivery", "completed"); await client.flush(true);
  expect(batches[0]).toHaveLength(16);
  expect(batches[0]?.at(-1)?.step).toBe("proof_delivery");
  const finish = client.begin("selfie_capture");
  client.setBackground(true);
  await Promise.resolve(); finish("cancelled", "cancelled");
  await Promise.resolve(); await Promise.resolve();
  expect(batches.flat().some(e => e.step === "selfie_capture" && e.status === "cancelled")).toBe(true);
  expect(requests.every(request => request.keepalive)).toBe(true);
});

test("telemetry never changes operation results or exposes arbitrary errors", async () => {
  const { client, batches } = fixture(503); client.setConsent("granted");
  const secret = new Error("https://rp.example/?k=SECRET biometric-score=0.3");
  expect(await client.run("credential_storage", async () => 7n)).toBe(7n);
  await expect(client.run("proof_delivery", async () => { throw secret; })).rejects.toBe(secret);
  await client.flush();
  expect(JSON.stringify(batches)).not.toContain("SECRET");
  expect(batches[0]?.at(-1)?.reason).toBe("operation_error");
  expect(analyticsReason(new DOMException("private", "NotAllowedError"))).toBe("permission_denied");
});

test("closed wire schema rejects secrets, nonfinite timings, invalid IDs and arbitrary error reasons", async () => {
  const { client, batches } = fixture(); client.setConsent("granted"); client.record("camera", "completed"); await client.flush();
  const event = batches[0]![0]!;
  expect(isAnalyticsEvent(event)).toBe(true);
  for (const value of [
    { ...event, proof: "secret" }, { ...event, flow_id: "account-id" }, { ...event, reason: "private error" },
    { ...event, duration_ms: Infinity }, { ...event, step: "credential_issued" }, { ...event, timestamp: "invalid" },
  ]) expect(isAnalyticsEvent(value)).toBe(false);
});
