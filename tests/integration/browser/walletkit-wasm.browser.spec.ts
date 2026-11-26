import { expect, test, type ConsoleMessage } from "@playwright/test";
import { installFixturePasskey, openSelfieRequest } from "../fixtures/request";

async function walletStorageOpened(message: ConsoleMessage): Promise<boolean> {
  if (!message.text().startsWith("authenticator_step")) return false;
  const fields = await message.args()[1]?.jsonValue().catch(() => undefined) as { step?: string; status?: string } | undefined;
  return fields?.step === "walletkit.storage_open" && fields.status === "completed";
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
    const blocked: string[] = [];
    page.on("console", message => { if (message.text().includes("Content Security Policy")) blocked.push(message.text()); });
    const opened = page.waitForEvent("console", { predicate: walletStorageOpened, timeout: 90_000 });
    const documents = page.waitForResponse(response => new URL(response.url()).pathname === "/verify");
    await openSelfieRequest(page);
    expect((await documents).headers()["content-security-policy"]).toContain("connect-src 'self' blob: ");
    await opened;
    expect(blocked).toEqual([]);
  });

  test("a WalletKit WASM the host cannot serve stops the request with an explicit error", async ({ page }) => {
    // A static host answers a missing file with index.html.
    await page.route("**/assets/walletkit-*.wasm.gzip.bin", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
    await openSelfieRequest(page);
    await expect(page.getByText("The authenticator could not load its wallet engine.")).toBeVisible();
  });
}
