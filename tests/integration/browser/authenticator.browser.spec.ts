import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { signedRequest, encryptedRequest } from "../fixtures/request";

if (!("bun" in process.versions)) {
  test("root is an authenticator, with no implicit RP or network registration", async ({ page }, info) => {
    const external: string[] = [];
    page.on("request", request => { if (!request.url().startsWith("http://127.0.0.1:4194")) external.push(request.url()); });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Download World ID" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: /passkey|Start selfie check|Cancel request/ })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Zoom");
    expect(external).toEqual([]);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(Math.round((await page.getByRole("main").boundingBox())!.width)).toBe(viewport.width);
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(249, 249, 248)");
      await expect(page.getByRole("main")).toHaveCSS("box-shadow", "none");
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-home-${viewport.width}.png`, fullPage: true });
    }
  });

  test("dev tools are opt-in, responsive and accessible without opening a wallet", async ({ page }, info) => {
    await page.addInitScript({ content: axe.source });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Download World ID" })).toBeVisible();
    const toggle = page.getByRole("switch", { name: "Dev mode" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await toggle.click();
    await expect(page.getByRole("heading", { name: "Developer tools" })).toBeVisible();
    await expect(page.getByText("Unlock your wallet to inspect its credentials.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue Faux credential" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Issue staging Selfie credential" })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/");
    for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-dev-${viewport.width}.png`, fullPage: true });
    }
    const violations = await page.evaluate(async () => {
      const runtime = (window as typeof window & { axe: { run(): Promise<{ violations: unknown[] }> } }).axe;
      return (await runtime.run()).violations;
    });
    expect(violations).toEqual([]);
    await toggle.click();
    await expect(page.getByRole("complementary")).toHaveCount(0);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("landing authenticator entry never starts camera or creates a passkey", async ({ page }) => {
    let cameraCalls = 0;
    await page.exposeFunction("recordCameraCall", () => { cameraCalls++; });
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        await (window as typeof window & { recordCameraCall(): Promise<void> }).recordCameraCall();
        throw new Error("Camera must not open from landing");
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Go to authenticator" }).click();
    await expect(page.getByRole("heading", { name: "Your authenticator" })).toBeVisible();
    await expect(page.getByText(/Complete a Selfie Check from an app request/)).toBeVisible();
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /passkey/i })).toHaveCount(0);
    expect(cameraCalls).toBe(0);
    expect(new URL(page.url()).pathname).toBe("/");
    await page.getByRole("button", { name: "Back to home" }).click();
    await expect(page.getByRole("heading", { name: "Download World ID" })).toBeVisible();
  });

  test("signed request link names the verified RP and sends an encrypted rejection on cancel", async ({ page }, info) => {
    const { payload, registry } = await signedRequest(11);
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
    await page.goto("/verify" + encrypted.query);
    await expect(page.getByRole("heading", { name: "Complete a Selfie Check" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start selfie check" })).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe("/verify");
    expect(new URL(page.url()).search).toBe("");
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-request-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-request-desktop.png`, fullPage: true });
    await page.getByRole("button", { name: "Cancel request" }).click();
    await expect(page.getByRole("heading", { name: "Check cancelled" })).toBeVisible();
    await expect.poll(() => rejected).toEqual({ error_code: "verification_rejected" });
  });

  test("invalid signature never exposes the wallet action", async ({ page }) => {
    const { payload, registry } = await signedRequest();
    registry.signer = `0x${"2".repeat(40)}`;
    const encrypted = await encryptedRequest(payload);
    await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
    await page.route("**/api/staging-rp?*", route => route.fulfill({ json: registry }));
    await page.goto("/verify" + encrypted.query);
    await expect(page.getByRole("heading", { name: "This request can’t be verified" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start selfie check" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create or unlock with passkey" })).toHaveCount(0);
  });

  test("expired request link ends on the intro without a way to continue", async ({ page }) => {
    const { payload, registry } = await signedRequest(1, { age: 700, ttl: 600 });
    const encrypted = await encryptedRequest(payload);
    await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
    await page.route("**/api/staging-rp?*", route => route.fulfill({ json: registry }));
    await page.goto("/verify" + encrypted.query);
    await expect(page.getByRole("heading", { name: "This request has expired" })).toBeVisible();
    await expect(page.getByText("Close this tab and return to the app to start again.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: /passkey|Start selfie check|Cancel request/ })).toHaveCount(0);
  });

  test.describe("first visit without a consent choice", () => {
    test.use({ extraHTTPHeaders: {} });

    test("the consent screen comes first, is accessible, and is recorded in an HttpOnly cookie", async ({ page, context, browserName }, info) => {
      await page.addInitScript({ content: axe.source });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Help improve World ID" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Download World ID" })).toHaveCount(0);
      const violations = await page.evaluate(async () => {
        const runtime = (window as typeof window & { axe: { run(): Promise<{ violations: unknown[] }> } }).axe;
        return (await runtime.run()).violations;
      });
      expect(violations).toEqual([]);
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-consent.png`, fullPage: true });
      await page.getByRole("button", { name: "Accept" }).click();
      await expect(page.getByRole("heading", { name: "Download World ID" })).toBeVisible();
      // WebKit refuses Secure cookies on plain-http loopback; production is HTTPS.
      if (browserName !== "chromium") return;
      const cookie = (await context.cookies()).find(c => c.name === "__Host-wid_consent");
      expect(cookie).toMatchObject({ value: "v1.granted", httpOnly: true, secure: true, sameSite: "Lax" });
      expect(await page.evaluate(() => document.cookie)).toBe("");
      await page.reload();
      await expect(page.getByRole("heading", { name: "Download World ID" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Help improve World ID" })).toHaveCount(0);
    });

    test("a request link shows the consent screen, then its intro", async ({ page }) => {
      const { payload, registry } = await signedRequest(11);
      const encrypted = await encryptedRequest(payload);
      await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
      await page.route("**/api/staging-rp?*", route => route.fulfill({ json: registry }));
      await page.goto("/verify" + encrypted.query);
      await expect(page.getByRole("heading", { name: "Help improve World ID" })).toBeVisible();
      await page.getByRole("button", { name: "Decline" }).click();
      await expect(page.getByRole("heading", { name: "Complete a Selfie Check" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start selfie check" })).toBeEnabled();
    });
  });

  test("built app passes automated accessibility checks", async ({ page }) => {
    await page.addInitScript({ content: axe.source });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Download World ID" })).toBeVisible();
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
    await page.getByRole("switch", { name: "Dev mode" }).click();
    await page.getByRole("button", { name: "Continue with passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("No automatic resubmission", { timeout: 90_000 });
    const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    expect(JSON.parse(saved["world-id-wallet-v1"])).toEqual({ version: 1, credentialId: expect.any(String) });
    expect(Object.values(saved)).toContain("submitting");
    const before = registrations;
    expect(before).toBe(1);
    await page.reload();
    await page.getByRole("switch", { name: "Dev mode" }).click();
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("No automatic resubmission", { timeout: 90_000 });
    expect(registrations).toBe(before);
    expect(await page.evaluate(() => localStorage.getItem("world-id-wallet-v1"))).toBe(saved["world-id-wallet-v1"]);
  });
  }
}
