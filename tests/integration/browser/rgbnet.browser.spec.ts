import { expect, test } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import type { DetectorResponse } from "../../../apps/authenticator/src/face/rgbnet.worker";

if (!("bun" in process.versions)) {
  for (const missing of [false, true]) {
    test(`built RGBNet worker ${missing ? "reports missing weights" : "runs real ONNX inference"}`, async ({ page }) => {
      test.skip(!missing && !existsSync("apps/authenticator/dist/models/rgbnet.onnx"), "Install the pinned RGBNet artifact to exercise real inference");
      test.setTimeout(60_000);
      const asset = readdirSync("apps/authenticator/dist/assets").find(name => /^rgbnet\.worker-.*\.js$/.test(name));
      expect(asset).toBeTruthy();
      if (missing) await page.route("**/models/rgbnet.onnx", route => route.fulfill({ status: 404, body: "Not found" }));
      await page.goto("/");
      const result = await page.evaluate(async ({ url, missing }) => {
        return new Promise<DetectorResponse>((resolve, reject) => {
          const worker = new Worker(url, { type: "module" });
          const timer = setTimeout(() => { worker.terminate(); reject(new Error("Detector test timed out")); }, 45_000);
          const finish = (value: DetectorResponse) => { clearTimeout(timer); worker.terminate(); resolve(value); };
          worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error("Built worker failed to load")); };
          worker.onmessage = ({ data }: MessageEvent<DetectorResponse>) => {
            if (data.type === "error" || data.type === "result") finish(data);
            if (data.type === "ready") {
              if (missing) { clearTimeout(timer); worker.terminate(); reject(new Error("Missing weights must not initialize")); return; }
              const canvas = new OffscreenCanvas(256, 256);
              const context = canvas.getContext("2d");
              if (!context) { clearTimeout(timer); worker.terminate(); reject(new Error("Test canvas unavailable")); return; }
              context.fillRect(0, 0, 256, 256);
              const bitmap = canvas.transferToImageBitmap();
              worker.postMessage({ type: "frame", id: 1, bitmap }, [bitmap]);
            }
          };
          worker.postMessage({ type: "init", diagnostics: false });
        });
      }, { url: `/assets/${asset}`, missing });
      if (missing) expect(result).toMatchObject({ type: "error", stage: "model download" });
      else {
        expect(result).toMatchObject({ type: "result", id: 1, width: 256, height: 256, faces: [] });
        if (result.type === "result") expect(result.timings).toContain("inference");
      }
    });
  }
}
