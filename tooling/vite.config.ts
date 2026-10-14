import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath, URL } from "node:url";

const repositoryUrl = new URL("../", import.meta.url);
const cleanRoot = fileURLToPath(repositoryUrl);
const appRoot = fileURLToPath(new URL("./apps/authenticator", repositoryUrl));

function path(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, repositoryUrl));
}

function rejectServerModulesFromBrowser(): Plugin {
  const forbidden = [
    path("./apps/authenticator/src/server/"),
    path("./services/"),
    path("./experiments/"),
    path("./tests/"),
    path("./packages/biometric-verification-port/"),
    path("./packages/staging-issuance-port/"),
  ];
  return {
    name: "clean-start-browser-server-boundary",
    enforce: "pre",
    load(id) {
      const normalized = id.split("?")[0] ?? id;
      if (
        forbidden.some((prefix) => normalized.startsWith(prefix)) ||
        /(?:^|\/)apps\/authenticator\/src\/.*\.server\.[cm]?[jt]sx?$/.test(normalized)
      ) {
        throw new Error("Server-only clean-start module entered the browser graph");
      }
      return null;
    },
  };
}

export default defineConfig({
  root: appRoot,
  plugins: [rejectServerModulesFromBrowser(), react()],
  publicDir: "public",
  worker: { format: "es" },
  resolve: {
    alias: {
      "@clean-start/browser-admission": path("./packages/browser-admission/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    fs: { allow: [cleanRoot] },
  },
  build: {
    target: "es2022",
    outDir: path("./apps/authenticator/dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
