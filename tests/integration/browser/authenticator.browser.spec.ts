import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { installCamera } from "../fixtures/camera";
import { signedRequest, encryptedRequest, openSelfieRequest } from "../fixtures/request";

// Pause when React commits the stage, before polling can skip a short animation.
async function hideAtStage(page: Page, stage: string) {
  await page.evaluate(stage => {
    const observer = new MutationObserver(() => {
      if (document.querySelector(".completion-sequence")?.getAttribute("data-stage") !== stage) return;
      observer.disconnect();
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  }, stage);
}

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

  test("public capture retries failure and automatically completes before optional saving", async ({ page }, info) => {
    await installCamera(page);
    const { payload, registry } = await signedRequest(11);
    const encrypted = await encryptedRequest(payload);
    await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
    await page.route("**/api/staging-rp?*", route => route.fulfill({ json: registry }));
    await page.goto("/verify" + encrypted.query + "&deny");
    await page.getByRole("button", { name: "Start selfie check" }).click();
    await expect(page.getByRole("heading", { name: "Allow camera access" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Selfie captured" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save with passkey" })).toHaveCount(0);
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-public-camera-failure.png`, fullPage: true });
    await page.evaluate(() => { (window as typeof window & { cameraTest: { deny: boolean } }).cameraTest.deny = false; });
    // Record completion atomically instead of racing it with separate browser round trips.
    const captureBorder = page.evaluate(() => new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('.completion-sequence')?.getAttribute("data-stage") !== "capture-border") return;
        observer.disconnect();
        resolve({
          goldDots: document.querySelectorAll('.selfie-design-ring circle[data-filled="true"]').length,
          still: !!document.querySelector('.selfie-photo'),
          checkmark: !!document.querySelector('.selfie-complete'),
          live: !!document.querySelector('video')?.srcObject,
          title: document.querySelector('.selfie-guidance h2')?.textContent,
          animationDuration: getComputedStyle(document.querySelector('.selfie-completion-border')!).animationDuration,
        });
      });
      observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    }));
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Looking good. Hold still" })).toBeVisible();
    const goldDots = page.locator('.selfie-design-ring circle[data-filled="true"]');
    await expect.poll(() => goldDots.count()).toBeGreaterThan(0);
    expect(await goldDots.count()).toBeLessThan(64);
    await expect(goldDots.first()).toHaveCSS("fill", "rgb(212, 175, 55)");
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-public-hold-progress.png`, fullPage: true });
    expect(await captureBorder).toEqual({ goldDots: 64, still: false, checkmark: false, live: true, title: "Selfie completed", animationDuration: "0.3s" });
    await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
    expect(await page.evaluate(() => (window as typeof window & { cameraTest: { stopped: number } }).cameraTest.stopped)).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Save with passkey" })).toHaveCount(0);
    await expect(page.locator(".request-completion")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-public-capture-success.png`, fullPage: true });
    await expect(page.getByRole("heading", { name: "Save your authenticator?" })).toBeVisible();
    await expect(page.locator(".public-request-flow--save")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-public-save-choice.png`, fullPage: true });
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-public-finished.png`, fullPage: true });
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test.describe("automatic completion lifecycle", () => {
    test.beforeEach(async ({ page }) => {
      await installCamera(page);
      await page.clock.install();
      const { payload, registry } = await signedRequest(11);
      const encrypted = await encryptedRequest(payload);
      await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
      await page.route("**/api/staging-rp?*", route => route.fulfill({ json: registry }));
      await page.goto("/verify" + encrypted.query);
    });

    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      test(`pauses hidden stages, clears the face, and finishes once (${reducedMotion})`, async ({ page }, info) => {
        await page.emulateMedia({ reducedMotion });
        const footerPosition = await page.getByRole("button", { name: "Cookie settings" }).boundingBox();
        await hideAtStage(page, "capture-complete");
        await page.getByRole("button", { name: "Start selfie check" }).click();
        await expect(page.locator('.completion-sequence')).toHaveAttribute("data-stage", "capture-complete");
        const photoUrl = await page.getByAltText("Your captured selfie").getAttribute("src");
        await page.clock.runFor(10_000);
        await expect(page.locator('.completion-sequence')).toHaveAttribute("data-stage", "capture-complete");
        await expect(page.getByAltText("Your captured selfie")).toBeAttached();
        await expect(page.getByRole("heading", { name: "Selfie completed" })).toBeVisible();
        await expect(page.locator(".selfie-camera-stage")).toHaveCSS("opacity", "1");
        await expect(page.locator(".selfie-camera-stage")).toHaveCSS("transform", "none");
        const border = page.locator(".selfie-completion-border");
        await expect(page.locator(".selfie-success-fill")).toHaveCount(0);
        await expect(border).toHaveCSS("fill", "none");
        await expect(border).toHaveCSS("stroke", "rgb(40, 168, 107)");
        await expect(border).toHaveCSS("stroke-dasharray", "1px, 0px");
        await expect(page.locator(".selfie-design-ring circle").first()).toBeHidden();
        await expect(border).toHaveCSS("animation-name", "none");
        await page.screenshot({ path: `test-results/screenshots/${info.project.name}-public-green-completion.png`, fullPage: true });
        expect(await page.evaluate(() => (window as typeof window & { cameraTest: { stopped: number } }).cameraTest.stopped)).toBeGreaterThan(0);
        await expect(page.getByRole("button")).toHaveCount(0);
        await hideAtStage(page, "confirmation");
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, value: false });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.clock.runFor(550);
        await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
        await expect(page.getByAltText("Your captured selfie")).toHaveCount(0);
        expect(await page.evaluate(async url => {
          try { await fetch(url!); return false; } catch { return true; }
        }, photoUrl)).toBe(true);
        await expect(page.locator(".request-completion")).toHaveCSS("animation-name", "none");
        await expect(page.locator(".request-completion")).toHaveCSS("opacity", "1");
        await page.clock.runFor(10_000);
        await expect(page.locator('.completion-sequence')).toHaveAttribute("data-stage", "confirmation");
        await expect(page.getByRole("button")).toHaveCount(0);
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, value: false });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.clock.runFor(2000);
        await expect(page.getByRole("heading", { name: "Save your authenticator?" })).toBeVisible();
        expect(await page.getByRole("button", { name: "Cookie settings" }).boundingBox()).toEqual(footerPosition);
        await page.getByRole("button", { name: "Not now" }).click();
        await page.clock.runFor(10_000);
        await expect(page.getByRole("heading", { name: "Selfie captured" })).toBeVisible();
        await expect(page.getByText("You can close this page.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Save with passkey" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
      });
    }

    test("leaving during completion cancels advancement and clears the image", async ({ page }) => {
      await hideAtStage(page, "capture-complete");
      await page.getByRole("button", { name: "Start selfie check" }).click();
      await expect(page.locator('.completion-sequence')).toHaveAttribute("data-stage", "capture-complete");
      const photoUrl = await page.getByAltText("Your captured selfie").getAttribute("src");
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
      await page.clock.runFor(10_000);
      await expect(page.getByAltText("Your captured selfie")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Selfie captured" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save with passkey" })).toHaveCount(0);
      expect(await page.evaluate(async url => {
        try { await fetch(url!); return false; } catch { return true; }
      }, photoUrl)).toBe(true);
    });
  });

  test("shared chrome stays in place across public screens without developer controls", async ({ page }, info) => {
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Download World ID" })).toBeVisible();
      const privacy = page.getByRole("link", { name: "Privacy", exact: true });
      const position = await privacy.boundingBox();
      expect(position).not.toBeNull();
      expect(position!.y).toBeGreaterThan(viewport.height - 100);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      expect(await privacy.boundingBox()).toEqual(position);
      await expect(page.getByRole("switch", { name: "Dev mode" })).toHaveCount(0);
      await expect(page.locator("#developer-panel")).toHaveCount(0);
      await page.getByRole("button", { name: "Go to authenticator" }).click();
      await expect(page.getByRole("heading", { name: "Your authenticator" })).toBeVisible();
      expect(await privacy.boundingBox()).toEqual(position);
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-saved-access-${viewport.width}.png`, fullPage: true });
      await page.getByRole("button", { name: "Cookie settings" }).click();
      await expect(page.getByRole("heading", { name: "Help improve World ID" })).toBeVisible();
      expect(await privacy.boundingBox()).toEqual(position);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
    }
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
    test.use({ storageState: { cookies: [], origins: [] } });

    test("the consent screen comes first, is accessible, and is recorded only in this browser", async ({ page, context }, info) => {
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
      expect(JSON.parse(await page.evaluate(() => localStorage.getItem("wid_consent") ?? "null"))).toMatchObject({ choice: "granted", version: "v1" });
      expect(await context.cookies()).toEqual([]);
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
    await installCamera(page);
    await openSelfieRequest(page, "", "http://localhost:4194");
    await page.getByRole("button", { name: "Save with passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("Setup didn’t finish", { timeout: 90_000 });
    const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    expect(JSON.parse(saved["world-id-wallet-v1"])).toEqual({ version: 1, credentialId: expect.any(String) });
    expect(Object.values(saved)).toContain("submitting");
    const before = registrations;
    expect(before).toBe(1);
    await page.goto("http://localhost:4194/");
    await page.getByRole("button", { name: "Go to authenticator" }).click();
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("Your authenticator couldn’t be opened", { timeout: 90_000 });
    expect(registrations).toBe(before);
    expect(await page.evaluate(() => localStorage.getItem("world-id-wallet-v1"))).toBe(saved["world-id-wallet-v1"]);
  });
  }
}
