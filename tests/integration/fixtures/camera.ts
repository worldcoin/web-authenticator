import { PoseGuardRuns } from "../../../api/lib/poseguard";
import { createPoseGuardHandlers } from "../../../api/routes/api/poseguard/handlers";
import type { PoseGuardEvidence } from "../../../packages/contracts/src/poseguard";
import type { Page } from "@playwright/test";

/** Synthetic camera and deterministic framing; never a biometric acceptance claim. */
export async function installCamera(page: Page) {
    // Exercise the real verifier with test authorization and a clock that follows page.clock.
    let clock = 0;
    const handlers = createPoseGuardHandlers(new PoseGuardRuns(() => clock), async () => ({ binding: "browser-fixture", expiresAt: Date.now() + 600_000 }));
    await page.route("**/api/poseguard/*", async route => {
      const kind = new URL(route.request().url()).pathname.split("/").at(-1) as keyof typeof handlers;
      const body = route.request().postDataJSON();
      if (kind === "verify") clock += (body.evidence as PoseGuardEvidence).frames.at(-1)!.t * 1000;
      const response = await handlers[kind](new Request(route.request().url(), { method: "POST", headers: await route.request().allHeaders(), body: JSON.stringify(body) }));
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await page.addInitScript(() => {
      const params = new URLSearchParams(location.search);
      const state = {
        stopped: 0, frames: 0, requested: 0,
        deny: params.has("deny"), aligned: !params.has("unaligned"), hang: params.has("hang"),
        releasePending: undefined as (() => void) | undefined,
      };
      Object.assign(window, { cameraTest: state });
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
        state.requested++;
        if (state.deny) throw new DOMException("Permission denied", "NotAllowedError");
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const context = canvas.getContext("2d")!;
        const paint = () => {
          context.fillStyle = state.frames++ % 2 ? "#707070" : "#717171";
          context.fillRect(0, 0, 640, 480);
        };
        paint();
        const stream = canvas.captureStream(30);
        const timer = setInterval(paint, 30);
        // Retain the patched wrappers: WebKit can recreate unreferenced track wrappers.
        const tracks = stream.getTracks();
        stream.getTracks = () => tracks;
        for (const track of tracks) {
          const stop = track.stop.bind(track);
          track.stop = () => { clearInterval(timer); state.stopped++; stop(); };
        }
        if (state.hang) return new Promise<MediaStream>(resolve => { state.releasePending = () => resolve(stream); });
        return stream;
      } } });
      // Exercise capture/lifecycle behavior without claiming ML acceptance.
      const NativeWorker = window.Worker;
      if (!params.has("real-worker")) {
        class PoseWorker {
          onmessage?: (event: { data: unknown }) => void;
          direction: string | undefined;
          fromX = 0; fromY = 0; x = 0; y = 0; toX = 0; toY = 0; moveAt = 0;
          postMessage(data: { type: string; id: number; t: number; frame?: ImageBitmap }) {
            data.frame?.close();
            if (data.type === "init") { setTimeout(() => this.onmessage?.({ data: { type: "ready", delegate: "CPU" } }), 0); return; }
            const direction = document.querySelector<HTMLElement>(".poseguard-target")?.style.getPropertyValue("--poseguard-direction");
            if (direction !== this.direction) {
              this.direction = direction;
              this.fromX = this.x; this.fromY = this.y; this.moveAt = data.t + .35;
              if (direction) {
                const angle = parseFloat(direction) * Math.PI / 180;
                this.toX = 22 * Math.cos(angle); this.toY = -22 * Math.sin(angle);
              } else { this.toX = this.x; this.toY = this.y; }
            }
            const u = .5 - .5 * Math.cos(Math.PI * Math.max(0, Math.min(1, (data.t - this.moveAt) / .6)));
            this.x = this.fromX + (this.toX - this.fromX) * u;
            this.y = this.fromY + (this.toY - this.fromY) * u;
            const yaw = -this.x, pitch = this.y;
            const landmarks = new Float32Array(478 * 3);
            for (const [a, b, iris, left] of [[33, 133, 468, .4], [362, 263, 473, .54]]) {
              landmarks[a * 3] = left; landmarks[b * 3] = left + .06;
              landmarks[a * 3 + 1] = landmarks[b * 3 + 1] = landmarks[iris * 3 + 1] = .4;
              landmarks[iris * 3] = (landmarks[a * 3] + landmarks[b * 3]) / 2 + (-.005 * yaw + .004 * Math.sin(data.t * 7)) * (landmarks[b * 3] - landmarks[a * 3]);
            }
            setTimeout(() => this.onmessage?.({ data: { type: "result", id: data.id, observation: {
              t: data.t, present: state.aligned, yaw, pitch, landmarks, width: 720, height: 960,
              fraction: .6, cx: 360, cy: 360, iod: 100,
            } } }), 0);
          }
          terminate() { this.onmessage = undefined; }
        }
        class CameraWorker {
          onmessage?: (event: { data: unknown }) => void;
          postMessage(data: { type: string; id: number; bitmap?: ImageBitmap }) {
            data.bitmap?.close();
            setTimeout(() => this.onmessage?.({ data: data.type === "init" ? { type: "ready" } : {
              type: "result", id: data.id, width: 640, height: 480, timings: "synthetic",
              faces: state.aligned ? [{ box: [0.3, 0.2, 0.7, 0.8], landmarks: [], score: 0.99 }] : [],
            } }), 0);
          }
          terminate() { this.onmessage = undefined; }
        }
        Object.assign(window, { Worker: new Proxy(NativeWorker, {
          construct(target, args) {
            return String(args[0]).includes("pose.worker") ? new PoseWorker() : String(args[0]).includes("rgbnet.worker") ? new CameraWorker() : Reflect.construct(target, args);
          },
        }) });
      }
    });
}
