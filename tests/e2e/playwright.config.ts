import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: resolve(repositoryRoot, "tests/integration/browser"),
  outputDir: resolve(repositoryRoot, "test-results"),
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: true,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: resolve(repositoryRoot, "playwright-report"), open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4194",
    // Global Privacy Control reads as a declined analytics choice, so flows other than the
    // consent tests start past the first-visit consent screen.
    extraHTTPHeaders: { "Sec-GPC": "1" },
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run start",
    cwd: repositoryRoot,
    env: {
      ...process.env,
      AUTHENTICATOR_HOST: "127.0.0.1",
      PORT: "4194",
    },
    port: 4194,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 393, height: 852 },
        permissions: ["camera"],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
    {
      name: "desktop-webkit",
      use: { browserName: "webkit", viewport: { width: 393, height: 852 } },
    },
  ],
});
