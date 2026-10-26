import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { installCamera } from "../fixtures/camera";

type DemoCamera = { requested: number; stopped: number; deny: boolean };
type SyntheticPose = { started: number; terminated: number; analyzed: number };

/** Synthetic observations exercise the real Session rules and UI, not model accuracy. */
async function installSyntheticPose(page: Page, mode: "absent" | "follow" | "eyes-follow-head") {
  await installCamera(page);
  await page.addInitScript(mode => {
    const state = { started: 0, terminated: 0, analyzed: 0 };
    Object.assign(window, { syntheticPose: state });
    const NativeWorker = window.Worker;
    class SyntheticPoseWorker {
      onmessage?: (event: { data: unknown }) => void;
      stopped = false;
      x = 0;
      y = 0;
      fromX = 0;
      fromY = 0;
      toX = 0;
      toY = 0;
      movedAt = 0;
      previousDirection = "";
      constructor() { state.started++; }
      postMessage(data: { type: string; id: number; frame?: ImageBitmap; t: number }) {
        const width = data.frame?.width ?? 720, height = data.frame?.height ?? 960;
        data.frame?.close();
        if (data.type === "init") {
          setTimeout(() => this.onmessage?.({ data: { type: "ready", delegate: "CPU" } }), 0);
          return;
        }
        state.analyzed++;
        // Follow the rendered target; do not replace the Session or its verdict.
        const target = document.querySelector<HTMLElement>(".poseguard-target");
        const targetDirection = target?.style.getPropertyValue("--poseguard-direction") ?? "";
        if (targetDirection && targetDirection !== this.previousDirection) {
          const direction = Number.parseFloat(targetDirection);
          this.fromX = this.x; this.fromY = this.y;
          this.toX = 22 * Math.cos(direction * Math.PI / 180);
          this.toY = -22 * Math.sin(direction * Math.PI / 180);
          this.movedAt = data.t;
          this.previousDirection = targetDirection;
        }
        if (targetDirection) {
          const progress = Math.max(0, Math.min(1, (data.t - this.movedAt) / 0.45));
          this.x = this.fromX + (this.toX - this.fromX) * progress;
          this.y = this.fromY + (this.toY - this.fromY) * progress;
        }
        const yaw = -this.x;
        const offset = (mode === "eyes-follow-head" ? 0.005 : -0.005) * yaw;
        const landmarks = new Float32Array(478 * 3);
        for (const [a, b, iris, left, right] of [[33, 133, 468, 0.4, 0.46], [362, 263, 473, 0.54, 0.6]]) {
          landmarks[3 * a] = left; landmarks[3 * b] = right;
          landmarks[3 * a + 1] = landmarks[3 * b + 1] = landmarks[3 * iris + 1] = 0.4;
          landmarks[3 * iris] = (left + right) / 2 + offset * (right - left);
        }
        setTimeout(() => {
          if (!this.stopped) this.onmessage?.({ data: {
            type: "result", id: data.id,
            observation: { t: data.t, present: mode !== "absent", yaw, pitch: this.y,
              landmarks, width, height, fraction: 0.6, cx: 360, cy: 480, iod: 140 },
          } });
        }, 0);
      }
      terminate() { if (!this.stopped) state.terminated++; this.stopped = true; this.onmessage = undefined; }
    }
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        return String(args[0]).includes("pose.worker") ? new SyntheticPoseWorker() : Reflect.construct(target, args);
      },
    });
  }, mode);
}

async function cameraState(page: Page): Promise<DemoCamera> {
  return page.evaluate(() => (window as typeof window & { cameraTest: DemoCamera }).cameraTest);
}

async function workerState(page: Page): Promise<SyntheticPose> {
  return page.evaluate(() => (window as typeof window & { syntheticPose: SyntheticPose }).syntheticPose);
}

function watchUploads(page: Page) {
  const uploads: string[] = [];
  page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) uploads.push(request.url()); });
  page.on("websocket", socket => uploads.push(socket.url()));
  return uploads;
}

if (!("bun" in process.versions)) {
  test("PoseGuard intro waits for Start before requesting camera or loading the model", async ({ page }) => {
    await installCamera(page);
    const modelRequests: string[] = [];
    page.on("request", request => { if (/mediapipe|pose\.worker/.test(request.url())) modelRequests.push(request.url()); });
    await page.goto("/poseguard");
    await expect(page.getByRole("heading", { name: "Try a movement check" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start check" })).toBeEnabled();
    await expect(page.getByText("Camera images stay on this device. This demo does not issue a credential.")).toBeVisible();
    await expect(page.locator("video")).toHaveCount(0);
    expect((await cameraState(page)).requested).toBe(0);
    expect(modelRequests).toEqual([]);
  });

  test("PoseGuard permission retry and Close release the synthetic camera and worker", async ({ page }) => {
    await installSyntheticPose(page, "absent");
    const uploads = watchUploads(page);
    await page.goto("/poseguard?deny");
    await page.getByRole("button", { name: "Start check" }).click();
    await expect(page.getByRole("heading", { name: "Allow camera access" })).toBeVisible();
    await expect(page.locator(".selfie-placeholder")).toHaveCount(0);
    await expect.poll(async () => (await workerState(page)).terminated).toBe(1);
    await page.evaluate(() => { (window as typeof window & { cameraTest: DemoCamera }).cameraTest.deny = false; });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Look straight at the camera" })).toBeVisible();
    await page.getByRole("button", { name: "Close movement check" }).click();
    await expect(page.getByRole("button", { name: "Start check" })).toBeVisible();
    expect((await cameraState(page)).stopped).toBeGreaterThan(0);
    expect(await workerState(page)).toMatchObject({ started: 2, terminated: 2 });
    await page.getByRole("button", { name: "Start check" }).click();
    await expect(page.getByRole("heading", { name: "Look straight at the camera" })).toBeVisible();
    await page.getByRole("button", { name: "Close movement check" }).click();
    expect((await cameraState(page)).stopped).toBeGreaterThanOrEqual(2);
    expect(await workerState(page)).toMatchObject({ started: 3, terminated: 3 });
    expect(uploads).toEqual([]);
  });

  test("synthetic head and eye observations complete the real PoseGuard rules without uploading", async ({ page }, info) => {
    await installSyntheticPose(page, "follow");
    const uploads = watchUploads(page);
    await page.goto("/poseguard");
    await page.getByRole("button", { name: "Start check" }).click();
    await expect(page.getByLabel("Movement 1 of 4")).toBeVisible();
    await expect(page.locator(".poseguard-target")).toBeVisible();
    await expect(page.locator(".poseguard-direction")).toHaveCount(0);
    await expect(page.locator(".poseguard-target")).toHaveCSS("border-top-color", "rgb(40, 168, 107)");
    await expect(page.locator(".poseguard-target")).not.toHaveCSS("mask-image", "none");
    const bumperGap = await page.locator(".poseguard-target").evaluate(element => {
      const target = element.getBoundingClientRect();
      const surface = element.parentElement!.querySelector(".selfie-camera-surface")!.getBoundingClientRect();
      const border = Number.parseFloat(getComputedStyle(element).borderTopWidth);
      return { horizontal: surface.left - target.left - border, vertical: surface.top - target.top - border };
    });
    expect(bumperGap.horizontal).toBeCloseTo(4, 1);
    expect(bumperGap.vertical).toBeCloseTo(4, 1);
    await expect(page.getByRole("status")).toContainText("Turn toward the green edge.");
    await expect(page.locator(".poseguard-fixation")).toBeVisible();
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-poseguard-synthetic-movement.png`, fullPage: true });
    for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator(".poseguard-fixation")).toBeVisible();
      const dot = await page.locator(".poseguard-fixation").boundingBox();
      const oval = await page.locator(".selfie-camera-surface").boundingBox();
      expect(dot!.x + dot!.width / 2).toBeCloseTo(oval!.x + oval!.width, 0);
      expect(dot!.y + dot!.height / 2).toBeCloseTo(oval!.y, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const heading = await page.getByRole("heading", { name: "Follow the movements" }).boundingBox();
      const steps = await page.locator(".poseguard-steps").boundingBox();
      const close = await page.getByRole("button", { name: "Close movement check" }).boundingBox();
      expect(steps!.y).toBeGreaterThanOrEqual(close!.y + close!.height + 4);
      if (heading!.height > 1) expect(steps!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height + 4);
      const hint = await page.locator(".selfie-hint").boundingBox();
      const footer = await page.getByRole("contentinfo").boundingBox();
      expect(hint!.y + hint!.height).toBeLessThanOrEqual(footer!.y - 8);
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-poseguard-synthetic-movement-${viewport.width}.png`, fullPage: true });
    }
    await expect(page.getByRole("heading", { name: "Movement check complete" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".poseguard-target")).toHaveCount(0);
    await expect(page.getByText("You followed all four movements. This demo was checked on your device.")).toBeVisible();
    await expect(page.getByAltText("Your captured selfie")).toBeVisible();
    expect((await cameraState(page)).stopped).toBeGreaterThan(0);
    expect(await workerState(page)).toMatchObject({ started: 1, terminated: 1 });
    for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const photoUrl = await page.getByAltText("Your captured selfie").getAttribute("src");
    await page.getByRole("button", { name: "Close movement check" }).first().click();
    await expect(page.getByRole("button", { name: "Start check" })).toBeVisible();
    await expect(page.getByAltText("Your captured selfie")).toHaveCount(0);
    expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, photoUrl)).toBe(true);
    expect(uploads).toEqual([]);
  });

  test("synthetic correct head movements with incorrect eye motion cannot show success", async ({ page }) => {
    await installSyntheticPose(page, "eyes-follow-head");
    const uploads = watchUploads(page);
    await page.goto("/poseguard");
    await page.getByRole("button", { name: "Start check" }).click();
    await expect(page.getByLabel("Movement 4 of 4")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Let's try that again" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("All four movements were captured, but we couldn't confirm your eyes stayed on the screen.");
    await expect(page.getByRole("status")).toContainText("keep looking at the dot while turning your head");
    await expect(page.getByRole("heading", { name: "Movement check complete" })).toHaveCount(0);
    await expect(page.getByAltText("Your captured selfie")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    expect((await cameraState(page)).stopped).toBeGreaterThan(0);
    expect(await workerState(page)).toMatchObject({ started: 1, terminated: 1 });
    expect(uploads).toEqual([]);
  });

  test("real MediaPipe worker runs under CSP and leaves a faceless stream inconclusive", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Real worker smoke is limited to Chromium; synthetic lifecycle also runs in WebKit.");
    test.skip(!existsSync("web/public/mediapipe/face_landmarker.task"), "Prepare the pinned MediaPipe model before the real inference smoke.");
    test.setTimeout(75_000);
    await installCamera(page);
    const uploads = watchUploads(page);
    const runtimeRequests: string[] = [], policyErrors: string[] = [];
    page.on("request", request => { if (request.url().includes("/mediapipe/")) runtimeRequests.push(request.url()); });
    page.on("console", message => { if (/Content Security Policy|Refused to (?:load|connect|create|execute|evaluate)/i.test(message.text())) policyErrors.push(message.text()); });
    await page.goto("/poseguard?real-worker");
    await page.getByRole("button", { name: "Start check" }).click();
    await expect(page.getByRole("heading", { name: "Look straight at the camera" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Let's get a clearer view" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: "Movement check complete" })).toHaveCount(0);
    await expect(page.getByAltText("Your captured selfie")).toHaveCount(0);
    expect(runtimeRequests.some(url => url.endsWith("/face_landmarker.task"))).toBe(true);
    expect(runtimeRequests.some(url => url.endsWith(".wasm"))).toBe(true);
    expect(policyErrors).toEqual([]);
    expect((await cameraState(page)).stopped).toBeGreaterThan(0);
    expect(uploads).toEqual([]);
  });
}
