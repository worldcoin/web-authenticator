import { expect, test } from "@playwright/test";
import { signedRequest, encryptedRequest } from "../fixtures/request";

const origins = ["https://web.world.org", "https://web.sandbox.world.org"];

// Serve the built app locally under its real browser origins; no live deployment is contacted.
if (!("bun" in process.versions)) {
  test.use({ storageState: { cookies: [], origins: origins.map(origin => ({ origin, localStorage: [
    { name: "wid_consent", value: JSON.stringify({ choice: "denied", version: "v1", at: Date.now() }) },
  ] })) } });

  for (const [origin, environment, accepted, endpoint] of [
    [origins[0]!, "production", true, "/api/rp"],
    [origins[0]!, "sandbox", false, "/api/rp"],
    [origins[1]!, "sandbox", true, "/api/staging-rp"],
    [origins[1]!, "production", false, "/api/staging-rp"],
  ] as const) {
    test(`${new URL(origin).hostname} ${accepted ? "accepts" : "rejects"} ${environment} requests`, async ({ page }) => {
      const { payload, registry } = await signedRequest();
      payload.environment = environment;
      const encrypted = await encryptedRequest(payload);
      const lookups: string[] = [];
      await page.route(origin + "/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/api/")) {
          lookups.push(url.pathname);
          await route.fulfill({ json: registry });
          return;
        }
        const response = await route.fetch({ url: "http://127.0.0.1:4194" + url.pathname + url.search });
        await route.fulfill({ response });
      });
      await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({
        json: encrypted.body, headers: { "access-control-allow-origin": "*" },
      }));
      await page.goto(origin + "/verify" + encrypted.query);
      if (accepted) {
        await expect(page.getByRole("button", { name: "Start selfie check" })).toBeEnabled();
        expect(lookups).toEqual([endpoint]);
      } else {
        await expect(page.getByRole("heading", { name: "This request can’t be verified" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Start selfie check" })).toHaveCount(0);
        expect(lookups).toEqual([]);
      }
    });
  }
}
