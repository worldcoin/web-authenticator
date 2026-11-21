import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

import { parseAppEnvironment, parsePoseGuardTestMode } from "../config/environment";
import { HEAD_POSE_MODEL } from "../config/head-pose-model";

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

function stagingHeadPoseAsset(source: string, required: boolean): Plugin {
  const readModel = async () => {
    const bytes = await readFile(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      if (!required) return;
      throw new Error("Provide the staging HeadPose model through POSEGUARD_HEAD_POSE_MODEL_FILE or .artifacts/models/head_pose.onnx.");
    });
    if (bytes && (bytes.length !== HEAD_POSE_MODEL.bytes || createHash("sha256").update(bytes).digest("hex") !== HEAD_POSE_MODEL.sha256)) {
      throw new Error("The HeadPose file does not match the pinned FaceEngine release.");
    }
    return bytes;
  };
  return {
    name: "staging-head-pose-asset",
    async generateBundle() {
      const bytes = await readModel();
      if (bytes) this.emitFile({ type: "asset", fileName: HEAD_POSE_MODEL.url.slice(1), source: bytes });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== HEAD_POSE_MODEL.url || (req.method !== "GET" && req.method !== "HEAD")) return next();
        if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
          (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) {
          res.writeHead(403).end();
          return;
        }
        try {
          const bytes = await readModel();
          if (!bytes) { res.writeHead(404).end(); return; }
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": bytes.length,
            "Cross-Origin-Resource-Policy": "same-origin",
            "Cache-Control": "private, max-age=31536000, immutable",
          }).end(req.method === "HEAD" ? undefined : bytes);
        } catch (error) {
          server.config.logger.error(error instanceof Error ? error.message : "Could not load the HeadPose model.");
          res.writeHead(503).end("The verified HeadPose model is unavailable.");
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, appRoot, "VITE_");
  const environment = parseAppEnvironment(env.VITE_APP_ENV ?? "staging");
  parsePoseGuardTestMode(env.VITE_POSEGUARD_TEST_MODE, environment);
  const modelFile = process.env.POSEGUARD_HEAD_POSE_MODEL_FILE;
  const modelSource = resolve(repositoryRoot, modelFile ?? ".artifacts/models/head_pose.onnx");
  const plugins = [rejectServerModulesFromBrowser(), react(), tailwindcss()];
  if (environment === "staging") {
    plugins.push(stagingHeadPoseAsset(modelSource, modelFile !== undefined));
  }
  return {
    root: appRoot,
    plugins,
    publicDir: "public",
    worker: { format: "es", plugins: () => [rejectServerModulesFromBrowser()] },
    // Discover ONNX before entering capture so Vite cannot reload an active camera attempt.
    optimizeDeps: { include: ["onnxruntime-web/wasm"] },
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      fs: { allow: [repositoryRoot], deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", modelSource, "**/head_pose.onnx"] },
    },
    build: {
      target: "es2022",
      outDir: path("./web/dist"),
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
