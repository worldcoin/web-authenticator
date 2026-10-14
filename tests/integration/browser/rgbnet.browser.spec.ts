import { expect, test } from "@playwright/test";
import { readdirSync } from "node:fs";

if (!("bun" in process.versions)) {
  test("shipped app has no camera preview or detector runtime", async ({ page }) => {
    const assets = readdirSync("web/dist/assets");
    expect(assets.filter(name => /^(rgbnet\.worker-|ort-wasm-)/.test(name))).toEqual([]);
    const modelRequests: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/models/")) modelRequests.push(request.url());
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "World ID authenticator" })).toBeVisible();
    await page.getByRole("switch", { name: "Dev mode" }).click();
    await expect(page.getByText("Not available in this app", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /camera preview/i })).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
    expect(modelRequests).toEqual([]);
  });
}
