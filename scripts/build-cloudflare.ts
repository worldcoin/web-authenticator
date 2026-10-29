import { copyFile, mkdir, readdir, rm, stat, writeFile, cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import model from "../web/lib/rgbnet-model.json";
import { COMPRESSED_WASM_PREFIX } from "../api/lib/cloudflare-assets";

const LIMIT = 25 * 1024 * 1024;
const root = resolve(import.meta.dir, "..");

export async function packageCloudflareAssets(source: string, output: string): Promise<number> {
  source = resolve(source);
  output = resolve(output);
  if (resolve(source) === resolve(output)) throw new Error("Asset output must differ from source");
  await rm(output, { recursive: true, force: true });
  await cp(source, output, { recursive: true });
  let compressedCount = 0;
  for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const size = (await stat(file)).size;
    if (size <= LIMIT) continue;
    if (!file.endsWith(".wasm")) throw new Error(`Static asset exceeds 25 MiB: ${entry.name}`);
    const compressed = gzipSync(await Bun.file(file).arrayBuffer(), { level: 9 });
    if (compressed.byteLength > LIMIT) throw new Error(`Compressed WASM exceeds 25 MiB: ${entry.name}; use R2 or reduce its size`);
    const pathname = file.slice(output.length).split("\\").join("/");
    const destination = join(output, `${COMPRESSED_WASM_PREFIX}${pathname}.gz`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, compressed);
    await rm(file);
    compressedCount++;
  }
  return compressedCount;
}

async function installModel(): Promise<void> {
  const destination = join(root, "web/public", model.url);
  const source = process.env.AUTHENTICATOR_RGBNET_PATH;
  if (source) {
    await mkdir(dirname(destination), { recursive: true });
    if (resolve(source) !== destination) await copyFile(source, destination);
  } else if (!(await Bun.file(destination).exists())) {
    let response: Response;
    try {
      response = await fetch(model.download, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error("RGBNet download failed (network error, timeout or redirect)");
    }
    if (!response.ok) throw new Error(`RGBNet download failed (HTTP ${response.status})`);
    // Bound the download even when the server omits Content-Length.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("RGBNet download was empty");
    const parts: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > model.bytes) { await reader.cancel(); throw new Error("RGBNet length mismatch"); }
      parts.push(part.value);
    }
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, new Blob(parts.map(part => new Uint8Array(part))));
  }
  const file = Bun.file(destination);
  if (file.size !== model.bytes) throw new Error("RGBNet length mismatch");
  const hash = new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex");
  if (hash !== model.sha256) throw new Error("RGBNet SHA-256 mismatch");
}

if (import.meta.main) {
  if (!process.argv.includes("--package-only")) {
    await installModel();
    const build = Bun.spawn(["bun", "run", "build:web"], { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (await build.exited !== 0) throw new Error("Web build failed");
  }
  const count = await packageCloudflareAssets(join(root, "web/dist"), join(root, ".artifacts/cloudflare/assets"));
  process.stdout.write(`Pre-compressed ${count} large WASM asset(s); every uploaded file is at most 25 MiB.\n`);
}
