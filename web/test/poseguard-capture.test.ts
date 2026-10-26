import { spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { capturePoseGuard, poseFramingGuidance } from "../lib/poseguard-capture";
import { analytics } from "../lib/analytics";
import { Session, Phase } from "../lib/poseguard";
import type { PoseObservation } from "../lib/poseguard";

const face = (t: number, changes: Partial<PoseObservation> = {}): PoseObservation => ({
  t, present: true, yaw: 0, pitch: 0, landmarks: null, width: 720, height: 960,
  fraction: 0.6, cx: 360, cy: 360, iod: 100, ...changes,
});

test("PoseGuard framing requires fresh, finite, steady frontal observations", () => {
  const steady = [face(0), face(0.15), face(0.3)];
  assert.equal(poseFramingGuidance(steady, 0.4), null);
  assert.equal(poseFramingGuidance(steady, 0.81), "Look straight at the camera");
  assert.equal(poseFramingGuidance([face(0), face(0.1)], 0.1), "Hold still");
  assert.equal(poseFramingGuidance([...steady.slice(0, 2), face(0.3, { cx: 380 })]), "Hold still");
  assert.equal(poseFramingGuidance([...steady.slice(0, 2), face(0.3, { iod: 110 })]), "Hold still");
  assert.equal(poseFramingGuidance([...steady.slice(0, 2), face(0.3, { fraction: NaN })]), "Hold still");
  assert.equal(poseFramingGuidance([face(0, { yaw: 7 })]), "Look straight at the camera");
  assert.equal(poseFramingGuidance([face(0, { fraction: 0.4 })]), "Move a little closer");
  assert.equal(poseFramingGuidance([face(0, { fraction: 0.9 })]), "Move a little farther away");
});

function harness() {
  let time = 10, videoTime = 0, nextTimer = 0;
  const options = { abortAfterSnapshot: true, encode: false };
  let stopped = 0, terminated = 0, analyzed = 0, encodeAt = -1;
  const timers = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const controller = new AbortController();
  const track = { stop: () => { stopped++; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() {} }),
    // Deliberately never finish JPEG encoding: it must not stop pose observations.
    toBlob(callback: (blob: Blob) => void) { encodeAt = analyzed; if (options.encode) callback(new Blob(["private-selfie"])); },
  };
  const video = {
    srcObject: null, readyState: 2, videoWidth: 720, videoHeight: 960, clientWidth: 360, clientHeight: 480,
    get currentTime() { return ++videoTime; },
    play: () => Promise.resolve(),
  } as unknown as HTMLVideoElement;
  const worker = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onmessageerror: undefined as (() => void) | undefined,
    postMessage(data: { type: string; id?: number; t?: number; frame?: ImageBitmap }) {
      if (data.type === "init") queueMicrotask(() => worker.onmessage?.({ data: { type: "ready", delegate: "GPU" } }));
      else {
        analyzed++;
        if (options.abortAfterSnapshot && encodeAt >= 0 && analyzed >= encodeAt + 2) controller.abort();
        const observation = face(data.t!);
        data.frame?.close();
        queueMicrotask(() => worker.onmessage?.({ data: { type: "result", id: data.id, observation } }));
      }
    },
    terminate() { terminated++; },
  };
  return {
    controller, stream, video, timers, intervals, options,
    getUserMedia: () => Promise.resolve(stream),
    replacements: {
      Worker: function () { return worker; },
      document: { createElement: () => canvas },
      createImageBitmap: () => Promise.resolve({ width: 720, height: 960, close() {} } as ImageBitmap),
      performance: { now: () => time * 1000 },
      setTimeout: (callback: () => void, milliseconds: number) => {
        const id = ++nextTimer;
        timers.set(id, callback);
        if (milliseconds <= 50) queueMicrotask(() => {
          if (timers.delete(id)) { time += milliseconds / 1000; callback(); }
        });
        return id;
      },
      clearTimeout: (id: number) => { timers.delete(id); },
      setInterval: (callback: () => void) => { const id = ++nextTimer; intervals.set(id, callback); return id; },
      clearInterval: (id: number) => { intervals.delete(id); },
    },
    counts: () => ({ stopped, terminated, analyzed, encodeAt }),
  };
}

async function withCapture(run: (h: ReturnType<typeof harness>) => Promise<void>) {
  const h = harness();
  const replacements = { ...h.replacements, navigator: { mediaDevices: { getUserMedia: () => h.getUserMedia() } } };
  const saved = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true });
  try { await run(h); }
  finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("PoseGuard keeps analyzing while JPEG encodes; abort releases the camera and worker", async () => {
  await withCapture(async h => {
    await assert.rejects(capturePoseGuard(h.video, h.controller.signal, () => {}), error => error instanceof DOMException && error.name === "AbortError");
    const counts = h.counts();
    assert.ok(counts.encodeAt >= 3);
    assert.ok(counts.analyzed >= counts.encodeAt + 2);
    assert.equal(counts.stopped, 1);
    assert.equal(counts.terminated, 1);
    assert.equal(h.video.srcObject, null);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.timers.size, 0);
  });
});

test("PoseGuard stops a camera permission result that arrives after cancellation", async () => {
  await withCapture(async h => {
    let grant!: (stream: MediaStream) => void;
    h.getUserMedia = () => new Promise(resolve => { grant = resolve; });
    const pending = capturePoseGuard(h.video, h.controller.signal, () => {});
    const rejected = assert.rejects(pending, error => error instanceof DOMException && error.name === "AbortError");
    h.controller.abort();
    await rejected;
    grant(h.stream);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(h.counts().stopped, 1);
    assert.equal(h.video.srcObject, null);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.timers.size, 0);
  });
});


for (const verdict of ["passed", "failed", "inconclusive"] as const) {
  test(`PoseGuard tracks each observed target once; final ${verdict} verdict gates the challenge result`, async () => {
    const events: { step: string; status: string; challenge?: string; challenge_index?: number; reason?: string }[] = [];
    const record = spyOn(analytics, "record").mockImplementation((step, status, fields) => {
      events.push({ step, status, challenge: fields?.challenge, challenge_index: fields?.challenge_index, reason: fields?.reason }); return true;
    });
    // Deterministic core outcomes; the pinned core's geometry/evaluation has its own fixture suite.
    let index = 0, phase: 0 | 1 | 2 = Phase.PAUSE;
    const spies = [
      spyOn(Session.prototype, "observe").mockImplementation(function (this: Session) {
        if (phase === Phase.PAUSE) phase = Phase.TARGET;
        else { index++; phase = index === this.targets.length ? Phase.DONE : Phase.PAUSE; }
      }),
      spyOn(Session.prototype, "phase").mockImplementation(() => phase),
      spyOn(Session.prototype, "index").mockImplementation(() => index),
      spyOn(Session.prototype, "done").mockImplementation(() => phase === Phase.DONE),
      spyOn(Session.prototype, "result").mockImplementation(() => ({ status: verdict, outcome: "private-verdict", reason: "private-reason", metrics: { faceScore: 0.9 } })),
    ];
    try {
      await withCapture(async h => {
        h.options.abortAfterSnapshot = false; h.options.encode = true;
        const capture = capturePoseGuard(h.video, h.controller.signal, () => {});
        if (verdict === "passed") assert.ok((await capture).image);
        else await assert.rejects(capture);
      });
      const targets = events.filter(e => e.step === "challenge_step");
      assert.ok(index > 0);
      for (let i = 1; i <= index; i++) assert.deepEqual(targets.filter(e => e.challenge_index === i).map(e => e.status), ["started", "completed"]);
      const challenge = events.filter(e => e.step === "physical_challenge");
      assert.deepEqual(challenge.map(e => e.status), ["started", verdict === "passed" ? "completed" : "failed"]);
      assert.ok(challenge.every(e => e.challenge === "poseguard"));
      assert.equal(challenge.at(-1)?.reason, verdict === "passed" ? undefined : verdict === "failed" ? "challenge_rejected" : "challenge_inconclusive");
      assert.equal(events.at(-1)?.step, "selfie_capture");
      assert.equal(events.at(-1)?.status, verdict === "passed" ? "completed" : "failed");
      assert.ok(!JSON.stringify(events).includes("private"));
      assert.ok(!JSON.stringify(events).includes("faceScore"));
    } finally { spies.reverse().forEach(spy => spy.mockRestore()); record.mockRestore(); }
  });
}

test("PoseGuard cancellation terminates its open challenge without successful capture", async () => {
  const events: { step: string; status: string }[] = [];
  const record = spyOn(analytics, "record").mockImplementation((step, status) => { events.push({ step, status }); return true; });
  try {
    await withCapture(async h => { await assert.rejects(capturePoseGuard(h.video, h.controller.signal, () => {})); });
    assert.deepEqual(events.filter(e => e.step === "physical_challenge").map(e => e.status), ["started", "cancelled"]);
    assert.deepEqual(events.at(-1), { step: "selfie_capture", status: "cancelled" });
  } finally { record.mockRestore(); }
});
