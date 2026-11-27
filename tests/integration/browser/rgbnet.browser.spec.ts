import { expect, test } from "@playwright/test";
import { installRequestWallet } from "../fixtures/request";

if (!("bun" in process.versions)) {
  test.beforeEach(async ({ page }) => { await installRequestWallet(page); });
  test("landing and saved access do not start the camera or load its runtime", async ({ page }) => {
    const modelRequests: string[] = [];
    page.on("request", request => {
      if (/\/models\/|pose\.worker-|ort-wasm-/.test(new URL(request.url()).pathname)) modelRequests.push(request.url());
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Dev mode" })).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
    expect(modelRequests).toEqual([]);
  });
}
