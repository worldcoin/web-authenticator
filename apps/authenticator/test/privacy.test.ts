import { describe, expect, test } from "bun:test";

async function sourceFiles(): Promise<readonly string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("**/*.{ts,tsx,css,html}");
  for await (const path of glob.scan({
    cwd: new URL("../", import.meta.url).pathname,
    absolute: true,
  })) files.push(path);
  return files;
}

describe("application privacy and isolation sentinels", () => {
  test("client modules import no server, gateway, simulator, or signing implementation", async () => {
    const files = (await sourceFiles()).filter((path) =>
      path.includes("/src/") && !path.includes("/src/server/"),
    );
    const forbidden = [
      "@clean-start/session-gateway",
      "@clean-start/simulated-biometric-verifier",
      "@clean-start/simulated-staging-issuer",
      "../server/",
      "/server/",
    ];
    for (const path of files) {
      const text = await Bun.file(path).text();
      for (const value of forbidden) {
        if (value === "localStorage" && path.endsWith("/src/wallet/session.ts")) continue;
        expect(text).not.toContain(value);
      }
    }
  });

  test("client modules contain no persistence, beacon, media serialization, or logging APIs", async () => {
    const files = (await sourceFiles()).filter((path) =>
      path.includes("/src/") && !path.includes("/src/server/"),
    );
    const forbidden = [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "sendBeacon",
      "serviceWorker",
      "MediaRecorder",
      "toDataURL",
      "convertToBlob",
      "createObjectURL",
      "FileReader",
      "FormData",
      "console.",
    ];
    for (const path of files) {
      const text = await Bun.file(path).text();
      for (const value of forbidden) {
        if (value === "localStorage" && path.endsWith("/src/wallet/session.ts")) continue;
        expect(text).not.toContain(value);
      }
    }
  });

  test("does not ship the Figma face photo or prohibited positive assurance copy", async () => {
    // The /demo walkthrough intentionally mirrors the production Figma copy
    // (owner decision, 2026-09-11) and is guarded separately in
    // production-presentation.test.tsx. The gated route and the frozen contract
    // copy stay covered here.
    const files = (await sourceFiles()).filter((path) =>
      (path.includes("/src/") || path.endsWith("/index.html")) &&
      !path.endsWith("/src/walkthrough/production-copy.ts"),
    );
    const prohibited = [
      "Proof of selfie",
      "prove your liveness",
      "you’re a real, unique person",
      "Verifying your selfie",
      "This might take few seconds",
      "verified human",
      "spoof detected",
    ];
    for (const path of files) {
      const text = await Bun.file(path).text();
      for (const value of prohibited) expect(text).not.toContain(value);
    }
    const assets = [...new Bun.Glob("public/assets/figma/*").scanSync({
      cwd: new URL("../", import.meta.url).pathname,
    })];
    expect(assets.some((path) => /face|selfie-photo|image-1/i.test(path))).toBe(false);
  });

  test("keeps safe-area, dynamic viewport, narrow-width, and reduced-motion rules", async () => {
    const css = await Bun.file(new URL("../src/styles/app.css", import.meta.url)).text();
    expect(css).toContain("100svh");
    expect(css).toContain("100dvh");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).not.toContain("min-width: 320px");
    expect(css).toContain(".app-main--has-top-close .staging-banner");
    expect(css).toContain("max-width: calc(100% - 72px)");
  });
});
