import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { installCamera } from "../fixtures/camera";
import { signedRequest, encryptedRequest, openSelfieRequest, installRequestWallet } from "../fixtures/request";

// Pause when React commits the stage, before polling can skip a short animation.
async function hideAtStage(page: Page, stage: string) {
  await page.evaluate(stage => {
    const observer = new MutationObserver(() => {
      if (document.querySelector("[data-stage]")?.getAttribute("data-stage") !== stage) return;
      observer.disconnect();
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  }, stage);
}

if (!("bun" in process.versions)) {
  test.beforeEach(async ({ page }, info) => {
    if (!info.title.startsWith("real virtual PRF") && !info.title.startsWith("creating a World ID shows progress")) await installRequestWallet(page);
  });
  test("root is an authenticator, with no implicit RP or network registration", async ({ page }, info) => {
    const external: string[] = [];
    page.on("request", request => { if (!request.url().startsWith("http://127.0.0.1:4194")) external.push(request.url()); });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Create a new World ID" })).toBeEnabled();
    await expect(page.locator("body")).not.toContainText("Zoom");
    expect(external).toEqual([]);
    // Only the analytics consent choice is stored before a passkey is saved.
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: ["wid_consent"], session: [] });
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(Math.round((await page.getByRole("main").boundingBox())!.width)).toBe(viewport.width);
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(249, 249, 248)");
      await expect(page.getByRole("main")).toHaveCSS("box-shadow", "none");
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-home-${viewport.width}.png`, fullPage: true });
    }
  });

  test("public capture retries failure and completes with its already unlocked wallet", async ({ page }, info) => {
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
        if (document.querySelector("[data-stage]")?.getAttribute("data-stage") !== "capture-border") return;
        observer.disconnect();
        resolve({
          goldDots: document.querySelectorAll('[data-testid=selfie-design-ring] circle[data-filled="true"]').length,
          still: !!document.querySelector('[data-testid=selfie-photo]'),
          checkmark: !!document.querySelector('[data-testid=selfie-complete]'),
          live: !!document.querySelector('video')?.srcObject,
          title: document.querySelector('[data-testid=selfie-guidance]')?.textContent,
          animationDuration: getComputedStyle(document.querySelector('[data-testid=selfie-completion-border]')!).animationDuration,
        });
      });
      observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    }));
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Looking good. Hold still" })).toBeVisible();
    const goldDots = page.locator('[data-testid=selfie-design-ring] circle[data-filled="true"]');
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
    await expect(page.getByTestId("request-completion")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-public-capture-success.png`, fullPage: true });
    await expect(page.getByText("You can close this page.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save with passkey" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `test-results/screenshots/${info.project.name}-public-finished.png`, fullPage: true });
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
        const footerPosition = await page.getByRole("button", { name: "Menu" }).boundingBox();
        await hideAtStage(page, "capture-complete");
        await page.getByRole("button", { name: "Start selfie check" }).click();
        await expect(page.locator("[data-stage]")).toHaveAttribute("data-stage", "capture-complete");
        const photoUrl = await page.getByAltText("Your captured selfie").getAttribute("src");
        await page.clock.runFor(10_000);
        await expect(page.locator("[data-stage]")).toHaveAttribute("data-stage", "capture-complete");
        await expect(page.getByAltText("Your captured selfie")).toBeAttached();
        await expect(page.getByRole("heading", { name: "Selfie completed" })).toBeVisible();
        await expect(page.getByTestId("selfie-camera-stage")).toHaveCSS("opacity", "1");
        await expect(page.getByTestId("selfie-camera-stage")).toHaveCSS("transform", "none");
        const border = page.getByTestId("selfie-completion-border");
        await expect(page.getByTestId("selfie-success-fill")).toHaveCount(0);
        await expect(border).toHaveCSS("fill", "none");
        await expect(border).toHaveCSS("stroke", "rgb(40, 168, 107)");
        await expect(border).toHaveCSS("stroke-dasharray", "1px, 0px");
        await expect(page.locator("[data-testid=selfie-design-ring] circle").first()).toBeHidden();
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
        await expect(page.getByTestId("request-completion")).toHaveCSS("animation-name", "none");
        await expect(page.getByTestId("request-completion")).toHaveCSS("opacity", "1");
        await page.clock.runFor(10_000);
        await expect(page.locator("[data-stage]")).toHaveAttribute("data-stage", "confirmation");
        await expect(page.getByRole("button")).toHaveCount(0);
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, value: false });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.clock.runFor(2000);
        await expect(page.getByText("You can close this page.")).toBeVisible();
        expect(await page.getByRole("button", { name: "Menu" }).boundingBox()).toEqual(footerPosition);
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
      await expect(page.locator("[data-stage]")).toHaveAttribute("data-stage", "capture-complete");
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

  test("menu keeps links and cookie settings available across viewport sizes", async ({ page, browserName }, info) => {
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
      const menu = page.getByRole("button", { name: "Menu" });
      const position = await menu.boundingBox();
      expect(position).not.toBeNull();
      expect(position!.y).toBeGreaterThan(viewport.height - 80);
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-saved-access-${viewport.width}.png`, fullPage: true });
      await menu.focus();
      await menu.press("Enter");
      await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-menu-${viewport.width}.png`, fullPage: true });
      // macOS WebKit uses Option-Tab to include links in keyboard navigation.
      await page.keyboard.press(browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");
      await expect(page.getByRole("link", { name: "World ID", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("link", { name: "Privacy" })).toHaveCount(0);
      await expect(menu).toBeFocused();
      await menu.click();
      await page.getByRole("button", { name: "Cookie settings" }).click();
      await expect(page.getByRole("heading", { name: "Help improve World ID" })).toBeVisible();
      expect(await menu.boundingBox()).toEqual(position);
      await expect(page.getByRole("switch", { name: "Dev mode" })).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create a new World ID" })).toBeEnabled();
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeEnabled();
    expect(cameraCalls).toBe(0);
    expect(new URL(page.url()).pathname).toBe("/");
    // The server serves the app on this path, so a reload keeps the screen.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
  });

  test("creating a World ID shows progress while the passkey request is pending", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "locks", { configurable: true, value: {
        request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}),
      } });
      if (typeof PublicKeyCredential === "undefined") {
        Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: class {} });
      }
      Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: () => {
        document.documentElement.dataset.passkeyRequested = "true";
        return new Promise(() => {});
      } } });
    });
    await page.goto("/");
    const signIn = page.getByRole("button", { name: "Sign in with passkey" });
    await expect(signIn).toBeEnabled();
    await expect(signIn).toHaveCSS("background-color", "rgb(10, 92, 254)");
    await page.getByRole("button", { name: "Create a new World ID" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-passkey-requested", "true");
    await expect(page.getByRole("status")).toContainText("Create your passkey to continue.");
    await page.screenshot({ path: "test-results/screenshots/passkey-progress.png" });
    await expect(signIn).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create a new World ID" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Link an authenticator/ })).toHaveCount(0);
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
      await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toHaveCount(0);
      const violations = await page.evaluate(async () => {
        const runtime = (window as typeof window & { axe: { run(): Promise<{ violations: unknown[] }> } }).axe;
        return (await runtime.run()).violations;
      });
      expect(violations).toEqual([]);
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-consent.png`, fullPage: true });
      await page.getByRole("button", { name: "Accept" }).click();
      await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
      expect(JSON.parse(await page.evaluate(() => localStorage.getItem("wid_consent") ?? "null"))).toMatchObject({ choice: "granted", version: "v1" });
      expect(await context.cookies()).toEqual([]);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Help improve World ID" })).toHaveCount(0);
    });

    test("a request link continues from consent into passkey unlock and camera", async ({ page }) => {
      await installCamera(page);
      const { payload, registry } = await signedRequest(11);
      const encrypted = await encryptedRequest(payload);
      await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
      await page.route("**/api/staging-rp?*", route => route.fulfill({ json: registry }));
      await page.goto("/verify" + encrypted.query);
      await expect(page.getByRole("heading", { name: "Help improve World ID" })).toBeVisible();
      await page.getByRole("button", { name: "Decline" }).click();
      await expect(page.getByRole("region", { name: "Selfie capture" })).toBeVisible();
    });
  });

  test("built app passes automated accessibility checks", async ({ page }) => {
    await page.addInitScript({ content: axe.source });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your World ID, in this browser." })).toBeVisible();
    const violations = await page.evaluate(async () => {
      const runtime = (window as typeof window & { axe: { run(): Promise<{ violations: unknown[] }> } }).axe;
      return (await runtime.run()).violations;
    });
    expect(violations).toEqual([]);
  });

  for (const scenario of [
    { name: "native buffers", providerArrays: false, omitCreationResults: false },
    { name: "provider arrays", providerArrays: true, omitCreationResults: false },
    { name: "assertion fallback", providerArrays: false, omitCreationResults: true },
  ]) {
  test(`real virtual PRF and WalletKit vault fail closed on unavailable account lookup (${scenario.name})`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Virtual PRF requires Chromium CDP");
    test.setTimeout(120_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true,
    } });
    await page.addInitScript(({ providerArrays, omitCreationResults }) => {
      const ceremonies = { create: 0, get: 0 };
      Object.assign(window, { passkeyCeremonies: ceremonies });
      const create = navigator.credentials.create.bind(navigator.credentials);
      const get = navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.create = options => { ceremonies.create++; return create(options); };
      navigator.credentials.get = options => { ceremonies.get++; return get(options); };
      const original = PublicKeyCredential.prototype.getClientExtensionResults;
      PublicKeyCredential.prototype.getClientExtensionResults = function () {
        const output = original.call(this);
        const prf = (output as unknown as { prf?: { results?: { first?: unknown } } }).prf;
        if (omitCreationResults && this.response instanceof AuthenticatorAttestationResponse && prf) delete prf.results;
        const result = prf?.results;
        if (providerArrays && result?.first instanceof ArrayBuffer) result.first = Array.from(new Uint8Array(result.first));
        return output;
      };
    }, scenario);
    const ceremonies = () => page.evaluate(() => (window as typeof window & { passkeyCeremonies: { create: number; get: number } }).passkeyCeremonies);
    let storageOpened = 0;
    page.on("console", message => {
      if (message.text().includes("walletkit.storage_open") && message.text().includes("completed")) storageOpened++;
    });
    let registrations = 0;
    await page.route("https://**/*", async route => {
      if (new URL(route.request().url()).pathname === "/create-account") registrations++;
      await route.fulfill({ status: 503, body: "test dependency unavailable", headers: { "access-control-allow-origin": "*" } });
    });
    await installCamera(page);
    await openSelfieRequest(page, "", "http://localhost:4194");
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible({ timeout: 90_000 });
    expect(await ceremonies()).toEqual({ create: 1, get: scenario.omitCreationResults ? 1 : 0 });
    expect(storageOpened).toBe(1);
    const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    expect(JSON.parse(saved["world-id-wallet-v1"])).toEqual({ version: 1, credentialId: expect.any(String) });
    expect(Object.values(saved)).not.toContain("submitting");
    const before = registrations;
    expect(before).toBe(0);
    await page.goto("http://localhost:4194/");
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("Retry with your existing passkey", { timeout: 90_000 });
    expect(await ceremonies()).toEqual({ create: 0, get: 1 });
    expect(storageOpened).toBe(2);
    expect(registrations).toBe(before);
    expect(await page.evaluate(() => localStorage.getItem("world-id-wallet-v1"))).toBe(saved["world-id-wallet-v1"]);
  });
  }
}
