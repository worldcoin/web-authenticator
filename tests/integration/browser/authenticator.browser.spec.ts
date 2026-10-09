import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { signedRequest, encryptedRequest } from "../fixtures/request";

if (!("bun" in process.versions)) {
  test("root is an authenticator, with no implicit RP or network registration", async ({ page }, info) => {
    const external: string[] = [];
    page.on("request", request => { if (!request.url().startsWith("http://127.0.0.1:4194")) external.push(request.url()); });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "World ID authenticator" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create or unlock with passkey" })).toBeEnabled();
    await expect(page.locator("body")).not.toContainText("Zoom");
    expect(external).toEqual([]);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-home-${viewport.width}.png`, fullPage: true });
    }
  });

  test("signed external request shows its requirements and sends encrypted rejection", async ({ page }, info) => {
    const { payload, registry } = await signedRequest(1);
    const encrypted = await encryptedRequest(payload);
    let rejected: unknown;
    await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
    await page.route("**/api/staging-rp?*", route => route.fulfill({ json: registry }));
    await page.route("https://staging-bridge.worldcoin.org/response/*", async route => {
      if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "PUT", "access-control-allow-headers": "content-type" } }); return; }
      const body = route.request().postDataJSON();
      const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(body.iv, "base64") }, encrypted.key, Buffer.from(body.payload, "base64"));
      rejected = JSON.parse(new TextDecoder().decode(bytes));
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    });
    await page.goto("/" + encrypted.query);
    await expect(page.getByRole("heading", { name: "Review your request" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Request details" }).getByText(/Accepted credentials.*Orb/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Request details" }).getByText(/Requesting RP.*rp_1/)).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-request-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-request-desktop.png`, fullPage: true });
    await page.getByRole("button", { name: "Cancel request" }).click();
    await expect(page.getByRole("heading", { name: "Request cancelled" })).toBeVisible();
    expect(rejected).toEqual({ error_code: "verification_rejected" });
  });

  test("invalid signature never exposes the wallet action", async ({ page }) => {
    const { payload, registry } = await signedRequest();
    registry.signer = `0x${"2".repeat(40)}`;
    const encrypted = await encryptedRequest(payload);
    await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
    await page.route("**/api/staging-rp?*", route => route.fulfill({ json: registry }));
    await page.goto("/" + encrypted.query);
    await expect(page.getByRole("heading", { name: "Request unavailable" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create or unlock with passkey" })).toHaveCount(0);
  });

  test("built app passes automated accessibility checks", async ({ page }) => {
    await page.addInitScript({ content: axe.source });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "World ID authenticator" })).toBeVisible();
    const violations = await page.evaluate(async () => {
      const runtime = (window as typeof window & { axe: { run(): Promise<{ violations: unknown[] }> } }).axe;
      return (await runtime.run()).violations;
    });
    expect(violations).toEqual([]);
  });

  for (const providerArrays of [false, true]) {
  test(`real virtual PRF and WalletKit vault survive a failed staging registration without resubmitting (${providerArrays ? "provider arrays" : "native buffers"})`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Virtual PRF requires Chromium CDP");
    test.setTimeout(120_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true,
    } });
    if (providerArrays) await page.addInitScript(() => {
      const original = PublicKeyCredential.prototype.getClientExtensionResults;
      PublicKeyCredential.prototype.getClientExtensionResults = function () {
        const output = original.call(this);
        const result = (output as unknown as { prf?: { results?: { first?: unknown } } }).prf?.results;
        if (result?.first instanceof ArrayBuffer) result.first = Array.from(new Uint8Array(result.first));
        return output;
      };
    });
    let registrations = 0;
    await page.route("https://**/*", async route => {
      if (new URL(route.request().url()).pathname === "/create-account") registrations++;
      await route.fulfill({ status: 503, body: "test dependency unavailable", headers: { "access-control-allow-origin": "*" } });
    });
    await page.goto("http://localhost:4194/");
    await page.getByRole("button", { name: "Create or unlock with passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("No automatic resubmission", { timeout: 90_000 });
    const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    expect(JSON.parse(saved["world-id-wallet-v1"])).toEqual({ version: 1, credentialId: expect.any(String) });
    expect(Object.values(saved)).toContain("submitting");
    const before = registrations;
    expect(before).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "Create or unlock with passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("No automatic resubmission", { timeout: 90_000 });
    expect(registrations).toBe(before);
    expect(await page.evaluate(() => localStorage.getItem("world-id-wallet-v1"))).toBe(saved["world-id-wallet-v1"]);
  });
  }
}
