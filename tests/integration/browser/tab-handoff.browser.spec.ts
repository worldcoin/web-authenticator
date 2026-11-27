import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installCamera } from "../fixtures/camera";
import { installFixturePasskey, openSelfieRequest } from "../fixtures/request";

// Two tabs share one origin's vault through the real WalletKit worker and WASM. Only the passkey
// provider and network services are fixtures: the indexer reports the account as registered.
if (!("bun" in process.versions)) {
  test.describe("tab handoff", () => {
    test.beforeEach(({ browserName }) => {
      // WebKit under Playwright has no origin private file system, so WalletKit cannot start there.
      test.skip(browserName !== "chromium", "WalletKit needs the origin private file system");
      test.setTimeout(120_000);
    });

    test("signing in in a new tab takes the wallet from a signed-in tab, and back", async ({ context }) => {
      await routeServices(context);
      const first = await tab(context);
      await first.goto("/authenticator");
      await first.getByRole("button", { name: "Create a new World ID" }).click();
      await expect(signedIn(first)).toBeVisible({ timeout: 60_000 });

      const second = await tab(context);
      await second.goto("/authenticator");
      await second.getByRole("button", { name: "Sign in with passkey" }).click();
      await expect(signedIn(second)).toBeVisible({ timeout: 60_000 });
      await expect(first.getByText("Continued in another tab.")).toBeVisible();
      await expect(signedIn(first)).toBeHidden();
      await expect(first.getByRole("alert")).toBeHidden();

      // The first tab can take it back the same way, with its own passkey prompt.
      await first.getByRole("button", { name: "Sign in with passkey" }).click();
      await expect(signedIn(first)).toBeVisible({ timeout: 60_000 });
      await expect(second.getByText("Continued in another tab.")).toBeVisible();
      expect(await prompts(first)).toEqual({ create: 1, get: 1 });
      expect(await prompts(second)).toEqual({ create: 0, get: 1 });
    });

    test("a request link opened in a new tab takes the wallet from a signed-in tab", async ({ context }) => {
      await routeServices(context);
      const first = await tab(context);
      await first.goto("/authenticator");
      await first.getByRole("button", { name: "Create a new World ID" }).click();
      await expect(signedIn(first)).toBeVisible({ timeout: 60_000 });

      const second = await tab(context);
      await installCamera(second);
      await openSelfieRequest(second);
      await expect(second.getByRole("region", { name: "Selfie capture" })).toBeVisible({ timeout: 60_000 });
      await expect(first.getByText("Continued in another tab.")).toBeVisible();
    });

    test("a tab in a check keeps the wallet, and a new tab says to finish there before any passkey prompt", async ({ context }) => {
      await routeServices(context);
      const first = await tab(context);
      await installCamera(first);
      await openSelfieRequest(first);
      const capture = first.getByRole("region", { name: "Selfie capture" });
      await expect(capture).toBeVisible({ timeout: 60_000 });

      for (const path of ["/authenticator", "/verify"] as const) {
        const second = await tab(context);
        if (path === "/verify") await openSelfieRequest(second);
        else {
          await second.goto(path);
          await second.getByRole("button", { name: "Sign in with passkey" }).click();
        }
        await expect(second.getByText("busy with a check in another tab")).toBeVisible({ timeout: 30_000 });
        expect(await prompts(second)).toEqual({ create: 0, get: 0 });
        await second.close();
      }
      await expect(capture).toBeVisible();
      await expect(first.getByText("Continued in another tab")).toBeHidden();
    });

    test("a tab that cannot hand over its storage gets a specific message", async ({ context }) => {
      await routeServices(context);
      // A tab from before the handoff: it opens WalletKit without taking the wallet lock, so
      // nothing can ask it to stop.
      const first = await tab(context);
      await first.addInitScript(() => {
        const request = navigator.locks.request.bind(navigator.locks) as (...args: unknown[]) => Promise<unknown>;
        Object.defineProperty(navigator.locks, "request", { configurable: true, value: (name: string, ...rest: unknown[]) => {
          if (name === "world-id-wallet-open-v1") { (rest.at(-1) as (lock: object) => unknown)({}); return new Promise(() => {}); }
          return request(name, ...rest);
        } });
      });
      await first.goto("/authenticator");
      await first.getByRole("button", { name: "Create a new World ID" }).click();
      await expect(signedIn(first)).toBeVisible({ timeout: 60_000 });

      const second = await tab(context);
      await second.goto("/authenticator");
      await second.getByRole("button", { name: "Sign in with passkey" }).click();
      await expect(second.getByRole("alert")).toHaveText("Your authenticator is still open in another tab or window. Close it, then try again. If no other tab is open, reload this page.", { timeout: 60_000 });
      await expect(signedIn(first)).toBeVisible();
    });
  });
}

/** A tab with the fixture passkey, counting its prompts. */
async function tab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await installFixturePasskey(page);
  await page.addInitScript(() => {
    const counted = { create: 0, get: 0 };
    Object.assign(window, { passkeyPrompts: counted });
    const { create, get } = navigator.credentials;
    Object.defineProperty(navigator, "credentials", { configurable: true, value: {
      create: (options?: CredentialCreationOptions) => { counted.create++; return create(options); },
      get: (options?: CredentialRequestOptions) => { counted.get++; return get(options); },
    } });
  });
  return page;
}

function prompts(page: Page) {
  return page.evaluate(() => (window as typeof window & { passkeyPrompts: { create: number; get: number } }).passkeyPrompts);
}

function signedIn(page: Page) {
  return page.getByText("0 credentials in your authenticator.");
}

/**
 * The indexer reports the account registered, so the wallet opens. Every other service never
 * answers, so a started check stays in progress.
 */
async function routeServices(context: BrowserContext) {
  await context.route("https://**/*", async route => {
    if (new URL(route.request().url()).pathname === "/packed-account") {
      await route.fulfill({ json: { packed_account_data: "0x1" }, headers: { "access-control-allow-origin": "*" } });
    }
  });
}
