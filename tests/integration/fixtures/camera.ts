import type { Page } from "@playwright/test";

/** Synthetic camera; never a biometric acceptance claim. */
export async function installCamera(page: Page) {
    await page.addInitScript(() => {
      const params = new URLSearchParams(location.search);
      const width = params.has("wide") ? 1280 : 640;
      const height = params.has("wide") ? 720 : 480;
      const state = {
        stopped: 0, frames: 0, requested: 0,
        deny: params.has("deny"), hang: params.has("hang"),
        releasePending: undefined as (() => void) | undefined,
      };
      Object.assign(window, { cameraTest: state });
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
        state.requested++;
        if (state.deny) throw new DOMException("Permission denied", "NotAllowedError");
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d")!;
        const paint = () => {
          context.fillStyle = state.frames++ % 2 ? "#707070" : "#717171";
          context.fillRect(0, 0, width, height);
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
    });
}
