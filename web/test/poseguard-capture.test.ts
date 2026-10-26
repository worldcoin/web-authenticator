import { test } from "bun:test";
import assert from "node:assert/strict";
import { capturePoseGuard, poseFramingGuidance } from "../lib/poseguard-capture";
import type { PoseObservation } from "../lib/poseguard";

const challenge = { id: "test", capability: "test", seed: "42", profile: "facepad-poseguard-v8", targets: [], expiresAt: Date.now()+120000 } as const;

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
  let stopped = 0, terminated = 0, analyzed = 0, encodeAt = -1, initialized = 0;
  let failGPU = false;
  let delegate: "GPU" | "CPU" = "GPU";
  const timers = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const controller = new AbortController();
  const track = { stop: () => { stopped++; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() {} }),
    // Deliberately never finish JPEG encoding: it must not stop pose observations.
    toBlob() { encodeAt = analyzed; },
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
    postMessage(data: { type: string; id?: number; t?: number; frame?: ImageBitmap; delegate?: "CPU" }) {
      if (data.type === "init") {
        initialized++; delegate = data.delegate ?? "GPU";
        queueMicrotask(() => worker.onmessage?.({ data: { type: "ready", delegate } }));
      }
      else {
        analyzed++;
        if (failGPU && delegate === "GPU") {
          data.frame?.close();
          queueMicrotask(() => worker.onmessage?.({ data: { type: "error", message: "GPU inference failed" } }));
          return;
        }
        if (encodeAt >= 0 && analyzed >= encodeAt + 2) controller.abort();
        const observation = face(data.t!);
        data.frame?.close();
        queueMicrotask(() => worker.onmessage?.({ data: { type: "result", id: data.id, observation } }));
      }
    },
    terminate() { terminated++; },
  };
  return {
    controller, stream, video, timers, intervals,
    set failGPU(value: boolean) { failGPU = value; },
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
    counts: () => ({ stopped, terminated, analyzed, encodeAt, initialized }),
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
    await assert.rejects(capturePoseGuard(h.video, h.controller.signal, () => {}, { ...challenge, targets: [] }), error => error instanceof DOMException && error.name === "AbortError");
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
    const pending = capturePoseGuard(h.video, h.controller.signal, () => {}, { ...challenge, targets: [] });
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



test("PoseGuard retries failed GPU inference on CPU before starting the challenge", async () => {
  await withCapture(async h => {
    h.failGPU = true;
    await assert.rejects(capturePoseGuard(h.video, h.controller.signal, () => {}, { ...challenge, targets: [] }), error => error instanceof DOMException && error.name === "AbortError");
    assert.equal(h.counts().initialized, 2);
    assert.equal(h.counts().terminated, 2);
    assert.equal(h.counts().stopped, 1);
    assert.ok(h.counts().encodeAt >= 3);
  });
});
