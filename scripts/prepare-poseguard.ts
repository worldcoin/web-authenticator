import { mkdir, readdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

// Pinned to the same bundle as FacePAD e5d90133. No biometric data is fetched.
const root = resolve(import.meta.dir, "..");
const destination = resolve(root, "web/public/mediapipe");
const runtime = resolve(root, "web/node_modules/@mediapipe/tasks-vision/wasm");
const expected = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";
const model = Bun.file(resolve(destination, "face_landmarker.task"));
await mkdir(resolve(destination, "wasm"), { recursive: true });
for (const name of await readdir(runtime)) {
  if (/^vision_wasm_[a-z_]+\.(js|wasm)$/.test(name)) {
    await copyFile(resolve(runtime, name), resolve(destination, "wasm", name));
  }
}
const bytes = await model.exists() ? await model.arrayBuffer() : await (async () => {
  const response = await fetch("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`PoseGuard model download failed: ${response.status}`);
  return response.arrayBuffer();
})();
const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (hash !== expected) throw new Error("PoseGuard model hash mismatch; refusing to use different weights.");
if (!(await model.exists())) await Bun.write(model, bytes);
