import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { fileURLToPath, URL } from "node:url";

import { ENVIRONMENTS, parseAppEnvironment } from "../config/environment";
import { cloudflareStaticHosting, compressedWalletKitWasm } from "./build/static-hosting";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const appRoot = fileURLToPath(new URL("./", import.meta.url));

function path(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, new URL("../", import.meta.url)));
}

function rejectNonProductModulesFromBrowser(): Plugin {
  const forbidden = [
    path("./web/build/"),
    path("./experiments/"),
    path("./tests/"),
  ];
  return {
    name: "browser-product-boundary",
    enforce: "pre",
    load(id) {
      const normalized = id.split("?")[0] ?? id;
      if (
        forbidden.some((prefix) => normalized.startsWith(prefix)) ||
        (!normalized.includes("/node_modules/") && normalized.startsWith(repositoryRoot) &&
          /(?:\.server\.[cm]?[jt]sx?$|\/(?:test|fixtures)\/)/.test(normalized))
      ) {
        throw new Error(`Browser builds cannot import build script, experiment, or test modules: ${normalized}`);
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, appRoot, "VITE_");
  const environment = parseAppEnvironment(env.VITE_APP_ENV ?? "staging");
  const { appOrigin, signupServiceOrigin } = ENVIRONMENTS[environment];
  return {
    root: appRoot,
    plugins: [
      rejectNonProductModulesFromBrowser(), react(), tailwindcss(),
      compressedWalletKitWasm(path("./web/node_modules/@worldcoin/walletkit-web/dist/generated/walletkit.wasm")),
      cloudflareStaticHosting(environment, process.env.RELEASE_COMMIT),
    ],
    publicDir: "public",
    worker: { format: "es", plugins: () => [rejectNonProductModulesFromBrowser()] },
    // Discover ONNX before entering capture so Vite cannot reload an active camera attempt.
    optimizeDeps: { include: ["onnxruntime-web/wasm"] },
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      fs: { allow: [repositoryRoot], deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**"] },
      // signup-service and its WAF accept browser requests only from the deployed app origin.
      // In dev, `selfieIssuer` targets this same-origin path, and the proxy presents that origin.
      proxy: {
        "/api/v2/identity": { target: signupServiceOrigin, changeOrigin: true, headers: { origin: appOrigin } },
      },
    },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true },
    build: {
      target: "es2022",
      outDir: path("./web/dist"),
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
