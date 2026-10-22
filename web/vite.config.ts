import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const appRoot = fileURLToPath(new URL("./", import.meta.url));

function path(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, new URL("../", import.meta.url)));
}

function rejectServerModulesFromBrowser(): Plugin {
  const forbidden = [
    path("./api/"),
    path("./experiments/"),
    path("./tests/"),
  ];
  return {
    name: "browser-server-boundary",
    enforce: "pre",
    load(id) {
      const normalized = id.split("?")[0] ?? id;
      if (
        forbidden.some((prefix) => normalized.startsWith(prefix)) ||
        (!normalized.includes("/node_modules/") && normalized.startsWith(repositoryRoot) &&
          /(?:\.server\.[cm]?[jt]sx?$|\/(?:test|fixtures)\/)/.test(normalized))
      ) {
        throw new Error(`Browser builds cannot import API, experiment, or test modules: ${normalized}`);
      }
      return null;
    },
  };
}

export default defineConfig({
  root: appRoot,
  plugins: [rejectServerModulesFromBrowser(), react()],
  publicDir: "public",
  worker: { format: "es", plugins: () => [rejectServerModulesFromBrowser()] },
  // Discover ONNX before entering capture so Vite cannot reload an active camera attempt.
  optimizeDeps: { include: ["onnxruntime-web/wasm"] },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
  },
  build: {
    target: "es2022",
    outDir: path("./web/dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
