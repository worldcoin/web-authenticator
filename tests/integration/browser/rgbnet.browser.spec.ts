import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { installCamera } from "../fixtures/camera";
import { openSelfieRequest } from "../fixtures/request";

async function openSelfie(page: Page, query = "") {
  await openSelfieRequest(page, query);
  await expect(page.getByRole("region", { name: "Selfie capture" })).toBeVisible();
}

if (!("bun" in process.versions)) {
  test("landing and saved access do not start the camera or load its runtime", async ({ page }) => {
    const modelRequests: string[] = [];
    page.on("request", request => {
      if (/\/models\/|rgbnet\.worker-|ort-wasm-/.test(new URL(request.url()).pathname)) modelRequests.push(request.url());
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Download World ID" })).toBeVisible();
    await page.getByRole("button", { name: "Go to authenticator" }).click();
    await expect(page.getByRole("heading", { name: "Your authenticator" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Dev mode" })).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
    expect(modelRequests).toEqual([]);
  });

  test.describe("local Selfie Check", () => {
    test.beforeEach(async ({ page }) => { await installCamera(page); });

    test("captures from an app request without uploading and stops the camera", async ({ page }) => {
      const uploads: string[] = [];
      page.on("request", request => { if (["POST", "PUT"].includes(request.method())) uploads.push(request.url()); });
      await openSelfie(page);
      await expect(page.getByRole("heading", { name: "Looking good. Hold still" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save with passkey" })).toBeVisible();
      expect(await page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
      expect(uploads).toEqual([]);
      await expect(page.locator("video")).toHaveCount(0);
      await page.getByRole("button", { name: "Not now" }).click();
      await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
    });

    test("losing alignment resets the hold", async ({ page }) => {
      await openSelfie(page);
      await expect(page.getByRole("heading", { name: "Looking good. Hold still" })).toBeVisible();
      await expect.poll(() => page.getByTestId("selfie-ring-progress").getAttribute("style")).not.toBe("stroke-dashoffset: 100;");
      await page.evaluate(() => { (window as any).cameraTest.aligned = false; });
      await expect(page.getByRole("heading", { name: "Let's see you" })).toBeVisible();
      await expect(page.getByTestId("selfie-ring-progress")).toHaveAttribute("style", "stroke-dashoffset: 100;");
      await expect(page.locator('[data-testid=selfie-design-ring] circle[data-filled="true"]')).toHaveCount(0);
      await page.evaluate(() => { (window as any).cameraTest.aligned = true; });
      await expect(page.getByRole("heading", { name: "Looking good. Hold still" })).toBeVisible();
      expect(await page.getByTestId("selfie-ring-progress").evaluate(el => Number((el as SVGElement).style.strokeDashoffset))).toBeGreaterThan(70);
      await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
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

    test("capture uses the page background, is responsive, and accessible", async ({ page }, info) => {
      await page.addInitScript({ content: axe.source });
      await openSelfie(page, "?deny");
      await expect(page.getByRole("heading", { name: "Allow camera access" })).toBeVisible();
      for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(viewport);
        await expect(page.getByTestId("request-frame")).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await expect(page.locator("body")).toHaveCSS("background-color", "rgb(249, 249, 248)");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
