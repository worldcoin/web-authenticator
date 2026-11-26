import { expect, test, type ConsoleMessage } from "@playwright/test";
import { installFixturePasskey, openSelfieRequest } from "../fixtures/request";

type FlowStep = { step?: string; status?: string; category?: string };

/** Console output is engine-specific, so steps are read from the logged object, not its text. */
async function flowStep(message: ConsoleMessage): Promise<FlowStep | undefined> {
  if (!message.text().startsWith("authenticator_step")) return undefined;
  return await message.args()[1]?.jsonValue().catch(() => undefined) as FlowStep | undefined;
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
    const opened = Promise.withResolvers<void>();
    page.on("pageerror", error => problems.push(`${error.name}: ${error.message}`));
    page.on("console", async message => {
      if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
      const step = await flowStep(message);
      if (!step) return;
      steps.push(`${step.step} ${step.status}${step.category ? ` (${step.category})` : ""}`);
      if (step.step === "walletkit.storage_open" && step.status === "completed") opened.resolve();
      if (step.status === "failed") opened.reject(new Error(`${step.step} failed`));
    });
    const documents = page.waitForResponse(response => new URL(response.url()).pathname === "/verify");
    await openSelfieRequest(page);
    expect((await documents).headers()["content-security-policy"]).toContain("connect-src 'self' blob: ");
    const outcome = await Promise.race([
      opened.promise.then(() => "opened", (error: Error) => error.message),
      new Promise<string>(resolve => setTimeout(() => resolve("timed out"), 60_000)),
    ]);
    expect({ outcome, steps, problems }).toEqual({ outcome: "opened", steps: expect.any(Array), problems: [] });
  });

  test("a WalletKit WASM the host cannot serve stops the request with an explicit error", async ({ page }) => {
    // A static host answers a missing file with index.html.
    await page.route("**/assets/walletkit-*.wasm.gzip.bin", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
    await openSelfieRequest(page);
    await expect(page.getByText("The authenticator could not load its wallet engine.")).toBeVisible();
  });
}
