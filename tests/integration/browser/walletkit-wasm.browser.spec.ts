import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { installFixturePasskey, openSelfieRequest } from "../fixtures/request";

type FlowStep = { step?: string; status?: string; category?: string };

/** Console output is engine-specific, so steps are read from the logged object, not its text. */
async function flowStep(message: ConsoleMessage): Promise<FlowStep | undefined> {
  if (!message.text().startsWith("authenticator_step")) return undefined;
  return await message.args()[1]?.jsonValue().catch(() => undefined) as FlowStep | undefined;
}

function hasPrivateFileSystem(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.storage.getDirectory().then(() => true, () => false));
}

// The real WalletKit worker and WASM run here; only the passkey provider and account services are fixtures.
if (!("bun" in process.versions)) {
  test.beforeEach(async ({ page }) => {
    await installFixturePasskey(page);
    await page.route("https://**/*", route => route.fulfill({
      status: 503, body: "test dependency unavailable", headers: { "access-control-allow-origin": "*" },
    }));
  });

  test("WalletKit starts from the gzipped WASM under the deployed security headers", async ({ page }) => {
    test.setTimeout(120_000);
    const steps: string[] = [];
    const problems: string[] = [];
    const settled = Promise.withResolvers<void>();
    page.on("pageerror", error => problems.push(`${error.name}: ${error.message}`));
    page.on("console", async message => {
      const step = await flowStep(message);
      if (!step) return;
      steps.push(`${step.step} ${step.status}${step.category ? ` (${step.category})` : ""}`);
      if (step.status === "failed") problems.push(`${step.step} failed (${step.category})`);
      if (step.step === "walletkit.storage_open" || step.status === "failed") settled.resolve();
    });
    const documents = page.waitForResponse(response => new URL(response.url()).pathname === "/verify");
    await openSelfieRequest(page);
    expect((await documents).headers()["content-security-policy"]).toContain("connect-src 'self' blob: ");
    await settled.promise;

    expect(steps).toContain("walletkit.wasm_load completed");
    // WalletKit keeps its vault in the origin private file system, which Playwright's WebKit does not
    // provide; there the worker cannot start, whatever the WASM was loaded from.
    if (await hasPrivateFileSystem(page)) {
      expect({ steps, problems }).toEqual({ steps: expect.arrayContaining(["walletkit.worker_initialize completed"]), problems: [] });
    }
  });

  test("a WalletKit WASM the host cannot serve stops the request with an explicit error", async ({ page }) => {
    // A static host answers a missing file with index.html.
    await page.route("**/assets/walletkit-*.wasm.gzip.bin", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
    await openSelfieRequest(page);
    await expect(page.getByText("The authenticator could not load its wallet engine.")).toBeVisible();
  });
}
