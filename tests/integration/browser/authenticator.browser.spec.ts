import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const screenshotRoot = resolve(import.meta.dirname, "../../../test-results/screenshots");
const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
] as const;

async function enablePasskey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
      automaticPresenceSimulation: true, hasPrf: true,
    },
  });
}

async function waitForStablePaint(page: Page) {
  await expect(page.locator("main h1")).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolvePaint) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint()));
  }));
}

if (!("bun" in process.versions)) {
test.beforeAll(() => mkdirSync(screenshotRoot, { recursive: true }));

test("built app opens the live flow at the root with no sensitive work before the passkey step", async ({
  page,
}, testInfo) => {
  const requests: Array<{ readonly url: string; readonly body: string | null }> = [];
  const consoleMessages: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) {
      requests.push({ url: request.url(), body: request.postData() });
    }
  });
  page.on("console", (message) => consoleMessages.push(message.text()));

  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main).toHaveAttribute("data-state", "request_review");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page).toHaveTitle("World ID");
  await expect(page.getByRole("heading", { name: "Request from Zoom" })).toBeVisible();
  await expect(page.getByText("Proof of selfie")).toBeVisible();
  await expect(page.locator(".staging-banner")).toHaveCount(1);
  await expect(page.locator(".template-notice")).toHaveCount(0);
  await expect(page.locator(".staging-banner")).toContainText("simulated");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(main).toHaveAttribute("data-state", "demo_authenticator_intro");
  await expect(page.getByRole("heading", { name: "Secure your World ID" })).toBeVisible();
  await expect(page.locator(".staging-banner")).toContainText("simulated");

  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/api/v0/bootstrap",
  ]);
  expect(requests[0]?.body).toBe("{}");
  expect(requests.some((request) => request.url.includes("/session/create"))).toBe(false);
  expect(consoleMessages.join("\n")).not.toMatch(/private|secret|signature|credential|receipt|frame|pixel/i);
  expect(await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    cookies: document.cookie,
    query: location.search,
  }))).toEqual({ local: [], session: [], cookies: "", query: "" });

  await waitForStablePaint(page);
  await page.screenshot({
    path: resolve(screenshotRoot, `${testInfo.project.name}-passkey-intro.png`),
    fullPage: true,
    animations: "disabled",
  });
});

test("responsive viewports, enlarged text, and dynamic height do not clip horizontally", async ({
  page,
}, testInfo) => {
  let enlargeText = false;
  await page.route(/\/assets\/.*\.css$/, async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    await route.fulfill({
      response,
      body: enlargeText
        ? `${original}\nh1,h2,p,span,button{font-size:200% !important;line-height:1.35 !important}`
        : original,
    });
  });
  for (const viewport of viewports) {
    enlargeText = false;
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("main")).toHaveAttribute("data-state", "request_review");
    const normal = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      mainWidth: document.querySelector("main")?.scrollWidth ?? 0,
      mainClientWidth: document.querySelector("main")?.clientWidth ?? 0,
      mainHeight: document.querySelector("main")?.scrollHeight ?? 0,
      viewportHeight: document.documentElement.clientHeight,
    }));
    expect(normal.documentWidth).toBeLessThanOrEqual(normal.viewportWidth);
    expect(normal.mainWidth).toBeLessThanOrEqual(normal.mainClientWidth);
    expect(normal.mainHeight).toBeGreaterThanOrEqual(normal.viewportHeight);

    enlargeText = true;
    await page.reload();
    await expect(page.getByRole("main")).toHaveAttribute("data-state", "request_review");
    const enlarged = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyHeight: document.body.scrollHeight,
    }));
    expect(enlarged.documentWidth).toBeLessThanOrEqual(enlarged.viewportWidth);
    expect(enlarged.bodyHeight).toBeGreaterThan(0);
  }

  const screenshotPage = await page.context().newPage();
  await screenshotPage.setViewportSize({ width: 393, height: 852 });
  await screenshotPage.goto("/");
  await expect(screenshotPage.getByRole("main")).toHaveAttribute("data-state", "request_review");
  await waitForStablePaint(screenshotPage);
  await screenshotPage.screenshot({
    path: resolve(screenshotRoot, `${testInfo.project.name}-request-review-393x852.png`),
    fullPage: true,
    animations: "disabled",
  });
  await screenshotPage.close();
});

test("automated accessibility and reduced-motion checks pass on the actual built page", async ({
  page,
}) => {
  await page.addInitScript({ content: axe.source });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const violations = await page.evaluate(async () => {
    const runtime = (window as typeof window & {
      axe: { run(root: Element): Promise<{ violations: unknown[] }> };
    }).axe;
    return (await runtime.run(document.querySelector("main")!)).violations;
  });
  expect(violations).toEqual([]);
  const motion = await page.evaluate(() => {
    const element = document.querySelector("button")!;
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      animationIterationCount: style.animationIterationCount,
      transitionDuration: style.transitionDuration,
      targetHeight: element.getBoundingClientRect().height,
    };
  });
  expect(["0s", "0.00001s", "1e-05s"]).toContain(motion.animationDuration);
  expect(["0s", "0.00001s", "1e-05s"]).toContain(motion.transitionDuration);
  expect(motion.animationIterationCount).toBe("1");
  expect(motion.targetHeight).toBeGreaterThanOrEqual(44);
  await expect(page.locator("main h1")).toBeFocused();
});

test("returned route is explicit and contains no browser-controlled callback payload", async ({
  page,
}, testInfo) => {
  await page.goto("/returned");
  await expect(page.getByRole("main")).toHaveAttribute("data-state", "returned");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText(/signature|receipt/i);
  await expect(page.locator("body")).toContainText("did not send a proof");
  expect(new URL(page.url()).search).toBe("");
  await waitForStablePaint(page);
  await page.screenshot({
    path: resolve(screenshotRoot, `${testInfo.project.name}-returned.png`),
    fullPage: true,
    animations: "disabled",
  });
});

test("records bounded synthetic navigation timing without setting a product budget", async ({
  page,
}, testInfo) => {
  const observations: number[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now();
    await page.goto("/");
    await expect(page.getByRole("main")).toHaveAttribute("data-state", "request_review");
    observations.push(Math.round((performance.now() - started) * 100) / 100);
  }
  expect(observations.every((value) => value > 0 && value < 120_000)).toBe(true);
  await testInfo.attach("desktop-synthetic-navigation-timing.json", {
    body: JSON.stringify({
      evidenceSurface: testInfo.project.name,
      metric: "navigation_to_request_review_ms",
      observations,
      productBudget: null,
    }),
    contentType: "application/json",
  });
});

test("root flow completes with live passkey invocation and camera fallback", async ({
  page, browserName,
}) => {
  await page.setViewportSize({ width: 1000, height: 852 });
  await page.addInitScript({ content: axe.source });
  test.skip(browserName !== "chromium", "Virtual WebAuthn PRF uses Chromium CDP");
  await enablePasskey(page);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "mediaDevices", {
      configurable: true,
      get: () => ({
        getUserMedia: () => Promise.reject(new DOMException("Denied", "NotAllowedError")),
      }),
    });
  });

  await page.goto("http://localhost:4173/");
  const main = page.getByRole("main");
  await expect(main).toHaveAttribute("data-state", "request_review");
  await expect(page.getByRole("heading", { name: "Request from Zoom" })).toBeVisible();
  await expect(page.getByText("Proof of selfie")).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.locator(".staging-banner")).toHaveCount(1);
  await expect(page.locator(".staging-banner")).toContainText("simulated");
  const walkthroughViolations = await page.evaluate(async () => {
    const runtime = (window as typeof window & {
      axe: { run(): Promise<{ violations: unknown[] }> };
    }).axe;
    return (await runtime.run()).violations;
  });
  expect(walkthroughViolations).toEqual([]);

  await page.locator('[data-action="continue"]').click();
  await expect(main).toHaveAttribute("data-state", "demo_authenticator_intro");
  await expect(page.getByRole("heading", { name: "Secure your World ID" })).toBeVisible();

  await page.locator('[data-action="start_demo_authenticator"]').click();
  await expect(main).toHaveAttribute("data-state", "demo_authenticator_ready", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Wallet unlocked" })).toBeVisible();
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("world-id-wallet-v1")!));
  expect(Object.keys(profile).sort()).toEqual(["credentialId", "version"]);
  expect(profile.credentialId).toMatch(/^[0-9a-f]+$/);
  await expect(page.locator('[data-action="continue_to_camera"]')).toHaveText("Start selfie check");
  await page.locator('[data-action="continue_to_camera"]').click();
  // The camera-intro state auto-advances before it paints; the camera opens directly.
  await expect(main).toHaveAttribute("data-state", "capture_preview");
  await expect(page.locator('[data-action="start_camera"]')).toHaveCount(0);
  await expect(page.locator('[data-action="collect_frame_metadata"]')).toHaveText("Continue");
  await page.locator('[data-action="collect_frame_metadata"]').click();
  await expect(main).toHaveAttribute("data-state", "simulated_credential_ready");
  await expect(main).toHaveAttribute("data-visual-source", "figma_5132_135104");
  await expect(page.getByRole("heading", { name: "Preview complete" })).toBeVisible();
  await expect(page.getByText("Simulated result — no Selfie Check credential was issued.")).toBeVisible();
  await expect(page.locator(".hero-icon")).toHaveAttribute("src", "/assets/figma/success-emblem.svg");
  await expect(page.getByRole("button", { name: "Return to Zoom" })).toBeVisible();
  await expect(page.locator(".staging-banner")).toContainText("simulated");

  await page.locator('[data-action="return_to_rp"]').click();
  await page.waitForURL("http://localhost:4173/returned");
  await expect(page.getByRole("main")).toHaveAttribute("data-state", "returned");
  await expect(page.getByRole("heading", { name: "Returned to Zoom" })).toBeVisible();
  await expect(page.locator(".staging-banner")).toContainText("simulated");
  await expect(page.getByRole("complementary")).toHaveCount(0);
});

test("the /demo alias serves the same live flow and returned page", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("main")).toHaveAttribute("data-state", "request_review");
  await expect(page.getByRole("heading", { name: "Request from Zoom" })).toBeVisible();
  await expect(page.locator(".staging-banner")).toContainText("simulated");
  await page.goto("/demo/returned");
  await expect(page.getByRole("main")).toHaveAttribute("data-state", "returned");
  await expect(page.getByRole("heading", { name: "Returned to Zoom" })).toBeVisible();
});

test("the same passkey reopens the encrypted wallet after reload", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Virtual WebAuthn PRF uses Chromium CDP");
  await enablePasskey(page);
  await page.goto("http://localhost:4173/");
  const unlock = async () => {
    await page.locator('[data-action="continue"]').click();
    await page.locator('[data-action="start_demo_authenticator"]').click();
    await expect(page.getByRole("heading", { name: "Wallet unlocked" })).toBeVisible({ timeout: 60_000 });
  };
  await unlock();
  const before = await page.evaluate(() => localStorage.getItem("world-id-wallet-v1"));
  await page.reload();
  await unlock();
  expect(await page.evaluate(() => localStorage.getItem("world-id-wallet-v1"))).toBe(before);
});

test("concurrent setup cannot replace wallet metadata", async ({ page }) => {
  await page.goto("http://localhost:4173/");
  await page.evaluate(() => new Promise<void>((ready) => {
    void navigator.locks.request("world-id-wallet-setup-v1", () => {
      ready();
      return new Promise<void>(() => {});
    });
  }));
  await page.locator('[data-action="continue"]').click();
  await page.locator('[data-action="start_demo_authenticator"]').click();
  await expect(page.getByRole("alert")).toContainText("Could not unlock");
  await expect(page.getByRole("main")).toHaveAttribute("data-state", "demo_authenticator_intro");
  expect(await page.evaluate(() => localStorage.getItem("world-id-wallet-v1"))).toBeNull();
});

test("cancelled passkey creation cannot advance to capture", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.credentials, "create", {
      value: () => Promise.reject(new DOMException("Cancelled", "NotAllowedError")),
    });
  });
  await page.goto("http://localhost:4173/");
  await page.locator('[data-action="continue"]').click();
  await page.locator('[data-action="start_demo_authenticator"]').click();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  await expect(page.getByRole("main")).toHaveAttribute("data-state", "demo_authenticator_intro");
  expect(await page.evaluate(() => localStorage.getItem("world-id-wallet-v1"))).toBeNull();
});

test("self-hosted face model emits live guidance and cleans up", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chromium project owns the deterministic fake camera");
  await page.setViewportSize({ width: 1000, height: 852 });
  const modelResponses: Array<{ readonly status: number; readonly url: string }> = [];
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://localhost:4173") {
      externalRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    if (
      response.url().includes("/mediapipe/") ||
      response.url().includes("/models/face_landmarker.task")
    ) {
      modelResponses.push({ status: response.status(), url: response.url() });
    }
  });
  await enablePasskey(page);

  await page.goto("http://localhost:4173/demo");
  for (const action of ["continue", "start_demo_authenticator"] as const) {
    await page.locator(`[data-action="${action}"]`).click();
  }
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-state",
    "demo_authenticator_ready", { timeout: 60_000 },
  );
  await page.locator('[data-action="continue_to_camera"]').click();
  await expect(page.getByRole("main")).toHaveAttribute("data-state", "capture_preview");
  await expect(page.locator('[data-live-guidance="face_not_found"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Move your face into the oval" })).toBeVisible();
  await expect(page.locator('[data-action="collect_frame_metadata"]')).toHaveCount(0);
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect();
      return bounds === undefined
        ? null
        : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    return {
      host: rect(".media-host--visible"),
      clip: rect(".media-clip"),
      ring: rect(".capture-ring"),
      clipPath: getComputedStyle(document.querySelector(".media-clip")!).clipPath,
    };
  });
  expect(geometry.ring).toEqual(geometry.host);
  expect(geometry.clip).toEqual(geometry.host);
  expect(geometry.clipPath.startsWith("polygon(")).toBe(true);
  expect(geometry.clipPath.split(",")).toHaveLength(64);
  expect(modelResponses.map(({ status }) => status)).toEqual([200, 200, 200]);
  expect(modelResponses.every(({ url }) => new URL(url).origin === "http://localhost:4173"))
    .toBe(true);
  expect(externalRequests).toEqual([]);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("main")).toHaveAttribute("data-state", "flow_cancelled");
  expect(await page.locator("video").evaluate(
    (video) => (video as HTMLVideoElement).srcObject,
  )).toBeNull();
});
}
