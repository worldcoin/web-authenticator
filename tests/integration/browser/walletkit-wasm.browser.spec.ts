import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { installFixturePasskey, openSelfieRequest } from "../fixtures/request";

// The real WalletKit worker and WASM run here; only the passkey provider and account services are fixtures.
if (!("bun" in process.versions)) {
  test.beforeEach(async ({ page }) => {
    await installFixturePasskey(page);
    await page.route("https://**/*", route => route.fulfill({
      status: 503, body: "test dependency unavailable", headers: { "access-control-allow-origin": "*" },
    }));
  });

  test("WalletKit starts from the gzipped WASM under the deployed security headers", async ({ page, browserName }) => {
    test.setTimeout(120_000);
    const flow = recordWalletFlow(page);
    const documents = page.waitForResponse(response => new URL(response.url()).pathname === "/verify");
    await openSelfieRequest(page);
    expect((await documents).headers()["content-security-policy"]).toContain("connect-src 'self' blob: ");
    await flow.settled;

    expect(flow.steps).toContain("walletkit.wasm_load completed");
    // WalletKit keeps its vault in the origin private file system, which Playwright's WebKit does not
    // provide. There the worker stops at its storage, after it has loaded the WASM.
    const privateFileSystem = await hasPrivateFileSystem(page);
    expect(privateFileSystem).toBe(browserName !== "webkit");
    expect(flow.failures).toEqual(privateFileSystem ? [] : ["walletkit.worker_initialize (OperationError)"]);
    if (privateFileSystem) expect(flow.steps).toContain("walletkit.storage_open completed");
  });

  test("a WalletKit WASM the host cannot serve stops the request with an explicit error", async ({ page }) => {
    // A static host answers a missing file with index.html.
    await page.route("**/assets/walletkit-*.wasm.gzip.bin", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
    await openSelfieRequest(page);
    await expect(page.getByText("The authenticator could not load its wallet engine.")).toBeVisible();
  });
}

type FlowStep = { step?: string; status?: string; category?: string };

/** Records the app's logged wallet steps in order until the vault opens or a step fails. */
function recordWalletFlow(page: Page) {
  const steps: string[] = [];
  const failures: string[] = [];
  const settled = Promise.withResolvers<void>();
  let reading = Promise.resolve();
  page.on("pageerror", error => failures.push(`${error.name}: ${error.message}`));
  page.on("console", message => {
    reading = reading.then(async () => {
      const step = await flowStep(message);
      if (!step) return;
      steps.push(`${step.step} ${step.status}`);
      if (step.status === "failed") failures.push(`${step.step} (${step.category})`);
      if (step.status === "failed" || (step.step === "walletkit.storage_open" && step.status === "completed")) settled.resolve();
    });
  });
  return { steps, failures, settled: settled.promise };
}

/** Console text is engine-specific, so a step is read from the logged object. */
async function flowStep(message: ConsoleMessage): Promise<FlowStep | undefined> {
  if (!message.text().startsWith("authenticator_step")) return undefined;
  return await message.args()[1]?.jsonValue().catch(() => undefined) as FlowStep | undefined;
}

function hasPrivateFileSystem(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.storage.getDirectory().then(() => true, () => false));
}
