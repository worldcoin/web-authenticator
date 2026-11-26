import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { installCamera } from "../fixtures/camera";
import { openSelfieRequest, installRequestWallet } from "../fixtures/request";

async function openSelfie(page: Page, query = "") {
  await openSelfieRequest(page, query);
  await expect(page.getByRole("region", { name: "Selfie capture" })).toBeVisible();
}

if (!("bun" in process.versions)) {
  test.beforeEach(async ({ page }) => { await installRequestWallet(page); });
  test("landing and saved access do not start the camera or load its runtime", async ({ page }) => {
    const modelRequests: string[] = [];
    page.on("request", request => {
      if (/\/models\/|rgbnet\.worker-|ort-wasm-/.test(new URL(request.url()).pathname)) modelRequests.push(request.url());
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Dev mode" })).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
    expect(modelRequests).toEqual([]);
  });

  test.describe("local Proof of Presence", () => {
    test.beforeEach(async ({ page }) => { await installCamera(page); });

    test("captures from an app request without uploading and stops the camera", async ({ page }) => {
      const uploads: string[] = [];
      page.on("request", request => { if (["POST", "PUT"].includes(request.method())) uploads.push(request.url()); });
      await openSelfie(page);
      await expect(page.getByRole("heading", { name: "Looking good. Hold still" })).toBeVisible();
      await expect(page.getByText("You can close this page.")).toBeVisible();
      expect(await page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
      expect(uploads).toEqual([]);
      await expect(page.locator("video")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
    });

    test("losing alignment resets the hold", async ({ page }) => {
      await page.clock.install();
      await openSelfie(page, "?unaligned");
      const framing = page.getByRole("heading", { name: "Let's see you" });
      const holding = page.getByRole("heading", { name: "Looking good. Hold still" });
      const filledDots = page.getByTestId("selfie-design-ring").locator('circle[data-filled="true"]');
      await expect(framing).toBeVisible();
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 500)));

      const setAlignment = async (aligned: boolean) => {
        await page.evaluate(value => { (window as any).cameraTest.aligned = value; }, aligned);
        const heading = aligned ? holding : framing;
        await expect.poll(async () => {
          // Advance the detector and animation together while the real video produces frames.
          await page.clock.runFor(50);
          return heading.isVisible();
        }, { intervals: [50] }).toBe(true);
      };
      await setAlignment(true);
      await page.clock.runFor(400);
      const initialDots = await filledDots.count();
      expect(initialDots).toBeGreaterThan(0);
      expect(initialDots).toBeLessThan(64);
      await expect(filledDots.first()).toHaveCSS("fill", "rgb(0, 124, 251)");
      await setAlignment(false);
      await expect(filledDots).toHaveCount(0);
      await setAlignment(true);
      expect(await filledDots.count()).toBeLessThan(initialDots);
      await page.clock.resume();
      await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
    });

    test("the circular close control accepts taps at the edge while the camera is opening", async ({ page }) => {
      await openSelfie(page, "?hang");
      await expect(page.getByTestId("camera-loading")).toBeVisible();
      await expect.poll(() => page.evaluate(() => typeof (window as any).cameraTest.releasePending)).toBe("function");
      const close = page.getByRole("button", { name: "Cancel check" });
      for (const width of [393, 1280]) {
        await page.setViewportSize({ width, height: 852 });
        const frame = await page.getByRole("region", { name: "Selfie capture" }).boundingBox();
        const box = await close.boundingBox();
        if (!frame || !box) throw new Error("Missing camera close button or capture frame");
        expect(box.width).toBe(40);
        expect(box.height).toBe(box.width);
        expect(box.x - frame.x).toBe(20);
        expect(box.y - frame.y).toBe(20);
        const icon = (await close.locator("svg").boundingBox())!;
        expect(icon.x + icon.width / 2).toBe(box.x + box.width / 2);
        expect(icon.y + icon.height / 2).toBe(box.y + box.height / 2);
      }
      // The 44 px target extends two pixels past the visible circle on either side.
      await close.click({ position: { x: 41, y: 20 } });
      await expect(page.getByRole("heading", { name: "Check cancelled" })).toBeVisible();
      await page.evaluate(() => { (window as any).cameraTest.releasePending(); });
      await expect.poll(() => page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
    });

    test("closing capture stops the camera and reopening starts fresh", async ({ page }) => {
      await openSelfie(page, "?unaligned");
      await expect(page.getByRole("heading", { name: "Let's see you" })).toBeVisible();
      await page.getByRole("button", { name: "Cancel check" }).click();
      expect(await page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
      await expect(page.getByRole("heading", { name: "Check cancelled" })).toBeVisible();
      await openSelfie(page);
      await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
    });

    test("permission denial has an actionable retry", async ({ page }) => {
      await openSelfie(page, "?deny");
      await expect(page.getByRole("heading", { name: "Allow camera access" })).toBeVisible();
      await expect(page.getByRole("status")).toContainText("site settings");
      await page.evaluate(() => { (window as any).cameraTest.deny = false; });
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
    });

    test("camera loading loops until the stream opens, then reveals the live preview", async ({ page }) => {
      await page.clock.install();
      await openSelfie(page, "?hang&unaligned");
      const loader = page.getByTestId("camera-loading");
      await expect(loader.locator("circle")).toHaveCount(13);
      await page.clock.fastForward(12_000);
      await expect(loader.locator("circle")).toHaveCount(13);
      await page.evaluate(() => { (window as any).cameraTest.releasePending(); });
      await expect(page.getByRole("region", { name: "Selfie capture" })).toHaveAttribute("data-camera-ready", "true");
      await expect(page.locator(".camera-aperture")).toHaveCSS("animation-name", "camera-open");
      await expect(loader).toHaveCount(0);
      await expect(page.locator("video")).toBeVisible();
    });

    test("the signed-in preview reveals a delayed camera before automatic capture", async ({ page }) => {
      await page.clock.install();
      await page.goto("/authenticator?hang");
      await page.getByRole("button", { name: "Sign in with passkey" }).click();
      await page.getByRole("button", { name: "Set up Proof of Presence" }).click();
      const capture = page.getByRole("region", { name: "Selfie capture" });
      await expect(capture.getByTestId("camera-loading")).toBeVisible();
      await expect.poll(() => page.evaluate(() => typeof (window as any).cameraTest.releasePending)).toBe("function");
      await page.clock.fastForward(2_000);

      const firstReady = await capture.evaluate(region => new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (region.getAttribute("data-camera-ready") !== "true") return;
          observer.disconnect();
          resolve({
            loading: !!region.querySelector('[data-testid="camera-loading"]'),
            live: !!region.querySelector("video")?.srcObject,
            captured: !!region.querySelector('[data-testid="selfie-photo"]'),
          });
        });
        observer.observe(region, { attributes: true, attributeFilter: ["data-camera-ready"] });
        (window as any).cameraTest.releasePending();
      }));
      expect(firstReady).toEqual({ loading: false, live: true, captured: false });
      await expect(capture.getByAltText("Your captured selfie")).toBeVisible();
    });

    test("reduced motion holds the dots still and opens the camera directly", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.clock.install();
      await openSelfie(page, "?hang&unaligned");
      const loader = page.getByTestId("camera-loading");
      const dot = loader.locator("circle").first();
      const initial = await dot.getAttribute("cx");
      await page.clock.fastForward(1_500);
      expect(await dot.getAttribute("cx")).toBe(initial);
      await page.evaluate(() => { (window as any).cameraTest.releasePending(); });
      await expect(page.getByRole("region", { name: "Selfie capture" })).toHaveAttribute("data-camera-ready", "true");
      expect(await loader.count()).toBe(0);
      await expect(page.locator(".camera-aperture")).toHaveCSS("animation-name", "none");
      await expect(page.locator(".camera-aperture > video")).toHaveCSS("transition-duration", "0.08s");
    });

    test("consent fades over a warm camera in the same card", async ({ page }) => {
      await page.addInitScript(() => {
        document.addEventListener("animationstart", event => {
          if (event.animationName !== "consent-exit" || !(event.target instanceof HTMLElement)) return;
          const intro = event.target;
          const card = intro.closest("main")!;
          card.dataset.consentOverlap = String(intro.inert && card.querySelector("video") !== null);
          card.dataset.consentExitDuration = getComputedStyle(intro).animationDuration;
        });
      });
      await openSelfie(page, "?unaligned");
      await expect(page.getByRole("region", { name: "Selfie capture" })).toHaveAttribute("data-camera-ready", "true");
      expect(await page.getByTestId("camera-loading").count()).toBe(0);
      await expect(page.getByRole("main")).toHaveAttribute("data-consent-overlap", "true");
      await expect(page.getByRole("main")).toHaveAttribute("data-consent-exit-duration", "0.12s");
      await expect(page.locator(".departing-intro")).toHaveCount(0);
      await expect(page.locator(".camera-aperture")).toHaveCSS("animation-duration", "0.18s");
    });

    test("permission deadline stops a stream that arrives late", async ({ page }) => {
      await page.clock.install();
      await openSelfie(page, "?hang");
      await expect(page.getByRole("heading", { name: "Opening your camera" })).toBeVisible();
      await page.clock.fastForward(30_001);
      await expect(page.getByRole("heading", { name: "Let's give that another try" })).toBeVisible();
      await page.evaluate(() => { (window as any).cameraTest.releasePending(); });
      await expect.poll(() => page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
    });

    test("backgrounding clears capture and returning automatically starts again", async ({ page }) => {
      await openSelfie(page, "?unaligned");
      await expect(page.getByRole("heading", { name: "Let's see you" })).toBeVisible();
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(page.getByRole("heading", { name: "Your camera is off" })).toBeVisible();
      expect(await page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
      await page.evaluate(() => {
        (window as any).cameraTest.aligned = true;
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
    });

    test("real RGBNet rejects a faceless stream", async ({ page }) => {
      await openSelfie(page, "?real-worker");
      await expect(page.getByRole("heading", { name: "Let's see you" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByAltText("Your captured selfie")).toHaveCount(0);
      await page.getByRole("button", { name: "Cancel check" }).click();
    });

    test("capture errors show the close control and bottom retry action across viewport sizes", async ({ page }, info) => {
      await page.addInitScript({ content: axe.source });
      await openSelfie(page, "?deny");
      await expect(page.getByRole("heading", { name: "Allow camera access" })).toBeVisible();
      for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(viewport);
        await expect(page.getByTestId("request-frame")).toHaveCSS("background-color", "rgb(255, 255, 255)");
        const card = page.getByRole("main");
        const border = viewport.width < 600 ? 0 : 1;
        const frame = (await card.boundingBox())!;
        expect(frame.width).toBe(viewport.width < 600 ? viewport.width : 480);
        expect(await page.getByRole("region", { name: "Selfie capture" }).boundingBox()).toEqual({
          x: frame.x + border, y: frame.y + border, width: frame.width - 2 * border, height: frame.height - 2 * border,
        });
        await expect(page.getByTestId("selfie-camera-stage")).toHaveCount(0);
        const retry = (await page.getByRole("button", { name: "Try again" }).boundingBox())!;
        const close = (await page.getByRole("button", { name: "Cancel check" }).boundingBox())!;
        expect(close.y - frame.y - border).toBe(20);
        expect(frame.y + frame.height - border - retry.y - retry.height).toBe(20);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
        expect(await page.getByRole("region", { name: "Selfie capture" }).evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `test-results/screenshots/${info.project.name}-selfie-${viewport.width}.png`, fullPage: true });
      }
      const violations = await page.evaluate(async () => {
        const runtime = (window as typeof window & { axe: { run(): Promise<{ violations: unknown[] }> } }).axe;
        return (await runtime.run()).violations;
      });
      expect(violations).toEqual([]);
    });
  });
}
