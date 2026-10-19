import type { Page } from "@playwright/test";

/** Synthetic camera and deterministic framing; never a biometric acceptance claim. */
export async function installCamera(page: Page) {
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
      if (!params.has("real-worker")) Object.assign(window, { Worker: class {
        onmessage?: (event: { data: unknown }) => void;
        postMessage(data: { type: string; id: number; bitmap?: ImageBitmap }) {
          data.bitmap?.close();
          setTimeout(() => this.onmessage?.({ data: data.type === "init" ? { type: "ready" } : {
            type: "result", id: data.id, width: 640, height: 480, timings: "synthetic",
            faces: state.aligned ? [{ box: [0.3, 0.2, 0.7, 0.8], landmarks: [], score: 0.99 }] : [],
          } }), 0);
        }
        terminate() { this.onmessage = undefined; }
      } });
    });
}
