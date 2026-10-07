import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/integration/browser",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run start:authenticator",
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      AUTHENTICATOR_HOST: "127.0.0.1",
      PORT: "4173",
      AUTHENTICATOR_PUBLIC_ORIGIN: "http://127.0.0.1:4173",
      AUTHENTICATOR_LOCAL_ORIGIN: "http://localhost:4173",
    },
    port: 4173,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium-synthetic",
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
      name: "desktop-webkit-synthetic",
      use: { browserName: "webkit", viewport: { width: 393, height: 852 } },
    },
  ],
});
