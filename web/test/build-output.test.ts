import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { build, type Rollup } from "vite";
import { RELEASE_FILE } from "../../config/build-manifest";
import { renderHeadersFile } from "../../config/security-headers";

const CLOUDFLARE_ASSET_LIMIT = 25 * 1024 * 1024;
const webRoot = resolve(import.meta.dir, "..");

test("the build is a complete Cloudflare static deployment", async () => {
  const { output } = await build({
    configFile: resolve(webRoot, "vite.config.ts"), logLevel: "silent", build: { write: false },
  }) as Rollup.RollupOutput;
  const files = new Map(output.map(file => [file.fileName, file.type === "asset" ? Buffer.from(file.source) : Buffer.from(file.code)]));

  expect(files.get("_headers")?.toString()).toBe(renderHeadersFile("staging"));
  expect(JSON.parse(files.get(RELEASE_FILE)!.toString())).toEqual({ environment: "staging", commit: process.env.RELEASE_COMMIT ?? null });
  for (const [name, bytes] of files) expect({ name, fits: bytes.byteLength <= CLOUDFLARE_ASSET_LIMIT }).toEqual({ name, fits: true });
  // Only these directories are cacheable, so the bundle must not put a file anywhere else.
  const outside = [...files.keys()].filter(name => !name.startsWith("assets/") && !["index.html", "_headers", RELEASE_FILE].includes(name));
  expect(outside).toEqual([]);

  // WalletKit's WASM ships only gzipped, and the app is told what it must decompress to.
  const walletKit = [...files.keys()].filter(name => name.includes("walletkit") && name.includes(".wasm"));
  expect(walletKit).toHaveLength(1);
  const original = await Bun.file(resolve(webRoot, "node_modules/@worldcoin/walletkit-web/dist/generated/walletkit.wasm")).bytes();
  expect(gunzipSync(files.get(walletKit[0]!)!).equals(original)).toBe(true);
  const loader = [...files].find(([name, bytes]) => name.endsWith(".js") && bytes.includes(walletKit[0]!))?.[1].toString();
  expect(loader).toContain(`/${walletKit[0]}`);
  expect(loader).toContain(`byteLength:${original.byteLength}`);
  expect(loader).toContain(createHash("sha256").update(original).digest("hex"));
}, 120_000);

// The capture diagnostics keep face images, so they must never reach a deployed build. Bun sets NODE_ENV=test,
// which Vite reads as a development build, so this build sets it the way a deploy does.
test("a production build leaves out the PoseGuard capture diagnostics", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { output } = await build({
      configFile: resolve(webRoot, "vite.config.ts"), logLevel: "silent", build: { write: false },
    }) as Rollup.RollupOutput;
    const leaked = output.filter(file => file.type === "chunk" &&
      ["PoseGuard debug", "poseguard-debug-", "Checked by the TEE only"].some(marker => file.code.includes(marker)));
    expect(leaked.map(file => file.fileName)).toEqual([]);
  } finally {
    process.env.NODE_ENV = previous;
  }
}, 120_000);
