import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { AUTHENTICATOR_APP_SECURITY_HEADERS_V0 } from "./config/authenticator-app-v0";

// Static demo build: `apps/authenticator/static-demo` runs the staging simulator
// inside the page, so the output under `apps/authenticator/dist-static` is a
// plain static site. Deploy that folder to Cloudflare Pages or Vercel.

function path(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

const outDir = path("./apps/authenticator/dist-static");

const MEDIAPIPE_RUNTIME_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
] as const;

// The served app sends these headers from the Bun server; static hosts need
// them as files. Cache-Control is left to the host so hashed assets stay cacheable.
const STATIC_HEADERS = Object.entries(AUTHENTICATOR_APP_SECURITY_HEADERS_V0)
  .filter(([name]) => name !== "Cache-Control");

function staticDemoHostFiles(): Plugin {
  return {
    name: "clean-start-static-demo-host-files",
    closeBundle() {
      mkdirSync(`${outDir}/mediapipe`, { recursive: true });
      for (const name of MEDIAPIPE_RUNTIME_FILES) {
        copyFileSync(
          path(`./node_modules/@mediapipe/tasks-vision/wasm/${name}`),
          `${outDir}/mediapipe/${name}`,
        );
      }
      writeFileSync(
        `${outDir}/_headers`,
        `/*\n${STATIC_HEADERS.map(([name, value]) => `  ${name}: ${value}`).join("\n")}\n`,
      );
      writeFileSync(`${outDir}/.assetsignore`, "vercel.json\n");
      writeFileSync(`${outDir}/vercel.json`, `${JSON.stringify({
        rewrites: [{ source: "/(.*)", destination: "/index.html" }],
        headers: [{
          source: "/(.*)",
          headers: STATIC_HEADERS.map(([key, value]) => ({ key, value })),
        }],
      }, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  root: path("./apps/authenticator/static-demo"),
  publicDir: path("./apps/authenticator/public"),
  plugins: [react(), staticDemoHostFiles()],
  resolve: {
    alias: {
      "@clean-start/contracts": path("./packages/contracts/src/index.ts"),
      "@clean-start/browser-admission": path("./packages/browser-admission/src/index.ts"),
      "@clean-start/frame-capture": path("./packages/frame-capture/src/index.ts"),
      "@clean-start/client-quality": path("./packages/client-quality/src/index.ts"),
      "@clean-start/session-gateway": path("./services/session-gateway/src/index.ts"),
      "@clean-start/biometric-verification-port": path("./packages/biometric-verification-port/src/index.ts"),
      "@clean-start/staging-issuance-port": path("./packages/staging-issuance-port/src/index.ts"),
      "@clean-start/simulated-biometric-verifier": path("./services/simulated-biometric-verifier/src/index.ts"),
      "@clean-start/simulated-staging-issuer": path("./services/simulated-staging-issuer/src/index.ts"),
      "@clean-start/app-config": path("./config/authenticator-app-v0.ts"),
    },
  },
  build: {
    target: "es2022",
    outDir,
    emptyOutDir: true,
    sourcemap: false,
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
});
