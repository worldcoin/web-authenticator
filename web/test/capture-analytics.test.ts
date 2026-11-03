import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { analytics } from "../lib/analytics";
import { captureSelfie } from "../lib/selfie-capture";
import { CAPTURE_HOLD_DURATION_MS_V1 } from "../lib/hold-steady-progress";
import * as detector from "../lib/face-detector";
import * as rgbnet from "../lib/rgbnet";

beforeAll(() => GlobalRegistrator.register({ url: "https://auth.example" }));
afterAll(() => GlobalRegistrator.unregister());
const restore: (() => void)[] = [];
afterEach(() => { restore.splice(0).reverse().forEach(fn => fn()); });

function fixture() {
  const events: { step: string; status: string; reason?: string }[] = [];
  const record = spyOn(analytics, "record").mockImplementation((step, status, fields) => {
    events.push({ step, status, reason: fields?.reason }); return true;
  }); restore.push(() => record.mockRestore());
  let stopped = 0;
  const track = { stop: () => { stopped++; }, addEventListener: () => {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
  restore.push(() => { if (descriptor) Object.defineProperty(navigator, "mediaDevices", descriptor); else Reflect.deleteProperty(navigator, "mediaDevices"); });
  const video = document.createElement("video");
  Object.defineProperty(video, "srcObject", { value: null, writable: true });
  Object.defineProperty(video, "videoWidth", { value: 640 }); Object.defineProperty(video, "videoHeight", { value: 480 });
  const play = spyOn(video, "play").mockResolvedValue(); restore.push(() => play.mockRestore());
  const canvas = spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ drawImage: () => {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  const blob = spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["private-photo"])));
  restore.push(() => canvas.mockRestore(), () => blob.mockRestore());
  let now = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => now); restore.push(() => clock.mockRestore());
  const frame = spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1); restore.push(() => frame.mockRestore());
  let onFrame: (() => void) | undefined;
  let aligned = true;
  const guidance = spyOn(rgbnet, "faceGuidance").mockImplementation(() => aligned ? "Face positioned" : "Center your face");
  const detection = spyOn(detector, "startFaceDetector").mockImplementation((_video, _signal, _enabled, onFaces) => {
    onFrame = () => onFaces([], 640, 480); return () => {};
  }); restore.push(() => guidance.mockRestore(), () => detection.mockRestore());
  return { video, events, stopped: () => stopped, frame: (time: number, positioned = true) => { now = time; aligned = positioned; onFrame!(); } };
}

test("capture completes once after a real image exists, without enrollment or proof success", async () => {
  const f = fixture();
  const result = captureSelfie(f.video, new AbortController().signal, () => {}, { trackAnalytics: true });
  void result.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  f.frame(10); f.frame(20, false); f.frame(30);
  // Keep detector observations fresh until the continuous hold is complete.
  for (let elapsed = 500; elapsed < CAPTURE_HOLD_DURATION_MS_V1; elapsed += 500) f.frame(30 + elapsed);
  f.frame(30 + CAPTURE_HOLD_DURATION_MS_V1);
  await result;
  expect(f.events.map(e => `${e.step}:${e.status}`)).toEqual([
    "selfie_capture:started", "selfie_capture:completed",
  ]);
  expect(f.stopped()).toBe(1);
  expect(JSON.stringify(f.events)).not.toContain("private-photo");
});

test("timeout during the challenge records the failed stage and never completes capture", async () => {
  const f = fixture(); const controller = new AbortController();
  const result = captureSelfie(f.video, controller.signal, () => {}, { trackAnalytics: true });
  void result.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 0)); f.frame(10);
  controller.abort(new DOMException("private timeout detail", "TimeoutError"));
  await expect(result).rejects.toThrow();
  expect(f.events.filter(e => e.status === "failed")).toEqual([
    { step: "selfie_capture", status: "failed", reason: "timeout" },
  ]);
  expect(f.events.some(e => e.step === "selfie_capture" && e.status === "completed")).toBe(false);
});

test("camera denial and background cancellation are distinct and late permission grants are released", async () => {
  const f = fixture();
  const media = spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(new DOMException("private", "NotAllowedError"));
  restore.push(() => media.mockRestore());
  await expect(captureSelfie(f.video, new AbortController().signal, () => {}, { trackAnalytics: true })).rejects.toThrow();
  expect(f.events.at(-1)).toEqual({ step: "selfie_capture", status: "failed", reason: "permission_denied" });
  f.events.length = 0;
  let grant!: (stream: MediaStream) => void;
  media.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  const controller = new AbortController(); const pending = captureSelfie(f.video, controller.signal, () => {}, { trackAnalytics: true });
  controller.abort(); await expect(pending).rejects.toThrow();
  let stopped = 0;
  grant({ getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(stopped).toBe(1);
  expect(f.events.map(e => `${e.step}:${e.status}`)).toEqual([
    "selfie_capture:started", "selfie_capture:cancelled",
  ]);
});


test("standalone camera previews do not enter the request capture funnel", async () => {
  const f = fixture();
  const media = spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(new DOMException("private", "NotAllowedError"));
  restore.push(() => media.mockRestore());
  await expect(captureSelfie(f.video, new AbortController().signal, () => {})).rejects.toThrow();
  expect(f.events).toEqual([]);
});
