import { expect, test } from "@playwright/test";
import { ENVIRONMENTS } from "../../../config/environment";
import { signedRequest, encryptedRequest, routeRpRegistry } from "../fixtures/request";

const configuredEnvironment = process.env.AUTHENTICATOR_TEST_ENVIRONMENT ?? "staging";
if (!["staging", "production"].includes(configuredEnvironment)) throw new Error("Invalid browser test environment");
const origins = ["https://web.world.org", "https://authenticator.toolsforhumanity.dev"];

// Serve the built app locally under its real browser origins; no live deployment is contacted.
if (!("bun" in process.versions)) {
  test.use({ storageState: { cookies: [], origins: origins.map(origin => ({ origin, localStorage: [
    { name: "wid_consent", value: JSON.stringify({ choice: "denied", version: "v1", at: Date.now() }) },
  ] })) } });
  // Rejections finish while the page is still loading assets through the proxy route below.
  // Let those in-flight handlers finish before teardown disposes their fetched responses.
  test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

  for (const [origin, environment, accepted, registryAddress] of [
    [origins[0]!, "production", configuredEnvironment === "production", ENVIRONMENTS.production.rpRegistry],
    [origins[0]!, "sandbox", false, ENVIRONMENTS.production.rpRegistry],
    [origins[1]!, "sandbox", configuredEnvironment === "staging", ENVIRONMENTS.staging.rpRegistry],
    [origins[1]!, "production", false, ENVIRONMENTS.staging.rpRegistry],
  ] as const) {
    test(`${new URL(origin).hostname} ${accepted ? "accepts" : "rejects"} ${environment} requests`, async ({ page }) => {
      const { payload, registry } = await signedRequest();
      payload.environment = environment;
      const encrypted = await encryptedRequest(payload);
      const lookups = await routeRpRegistry(page, registry);
      await page.route(origin + "/**", async route => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: "http://127.0.0.1:4194" + url.pathname + url.search });
        await route.fulfill({ response });
      });
      await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({
        json: encrypted.body, headers: { "access-control-allow-origin": "*" },
      }));
      await page.goto(origin + "/verify" + encrypted.query);
      if (accepted) {
        await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
        expect(lookups.map(address => address.toLowerCase())).toEqual([registryAddress.toLowerCase()]);
      } else {
        await expect(page.getByRole("heading", { name: "This request can’t be verified" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
        expect(lookups).toEqual([]);
      }
    });
  }
}
