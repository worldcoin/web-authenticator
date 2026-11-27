import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { HEAD_POSE_MODEL } from "../../../config/head-pose-model";
import rgbnet from "../rgbnet-model.json";
import { decodeRgbnet, INPUT_SIZE, prepareRgbnet, resizeAxisWeights, type FaceDetection } from "../rgbnet";
import { eyeRoll } from "./engine-checks";
import type { PoseObservation, PoseWorkerRequest, PoseWorkerResponse } from "./types";

const POSE_SIZE = 224;
let detector: ort.InferenceSession | undefined;
let estimator: ort.InferenceSession | undefined;

self.onmessage = async ({ data }: MessageEvent<PoseWorkerRequest>) => {
  try {
    if (data.type === "init") {
      await initialize();
      send({ type: "ready" });
      return;
    }
    try {
      send({ type: "result", pose: await analyze(data.frame) });
    } finally {
      data.frame.close();
    }
  } catch {
    send({
      type: "error",
      message: data.type === "init" ? "Could not load the verified FaceEngine models." : "FaceEngine could not estimate head pose.",
    });
  }
};

function send(response: PoseWorkerResponse) {
  self.postMessage(response);
}

async function initialize() {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = {
    wasm: new URL(wasmUrl, self.location.href).href,
    mjs: new URL(wasmModuleUrl, self.location.href).href,
  };
  const [headPose, rgbnetBytes] = await Promise.all([loadModel(HEAD_POSE_MODEL), loadModel(rgbnet)]);
  const options = { executionProviders: ["wasm"] };
  detector = await ort.InferenceSession.create(rgbnetBytes, options);
  estimator = await ort.InferenceSession.create(headPose, options);
  if (detector.inputNames.length !== 1 || detector.outputNames.length !== 3 ||
    estimator.inputNames.length !== 1 || estimator.outputNames.length !== 1) {
    throw new Error("Unexpected FaceEngine model interface.");
  }
}

async function loadModel(model: { url: string; bytes: number; sha256: string }) {
  const response = await fetch(model.url, { cache: "force-cache", credentials: "omit", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("The model could not be downloaded.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== model.bytes) throw new Error("Unexpected model size.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if (Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("") !== model.sha256) {
    throw new Error("Unexpected model checksum.");
  }
  return bytes;
}

async function analyze(frame: ImageBitmap): Promise<PoseObservation | null> {
  if (!detector || !estimator) throw new Error("FaceEngine is not ready.");
  const { width, height } = frame;
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error("Unsupported camera frame size.");
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(frame, 0, 0);
  const { data } = context.getImageData(0, 0, width, height);
  try {
    const faces = await infer(detector, prepareRgbnet(data, width, height), INPUT_SIZE, outputs =>
      decodeRgbnet(outputs.map(output => ({ dims: output.dims, data: output.data as Float32Array }))));
    if (faces.length !== 1) return null;
    const face = faces[0];
    const input = poseInput(data, width, height, face);
    if (!input) return null;
    return await infer(estimator, input, POSE_SIZE, outputs => {
      const raw = outputs[0]?.data;
      if (!(raw instanceof Float32Array) || raw.length !== 2 || !raw.every(Number.isFinite)) {
        throw new Error("Unexpected pose model output.");
      }
      const [left, top, right, bottom] = face.box;
      return {
        left, top, right, bottom,
        yaw: Math.tanh(raw[1]) * 85,
        pitch: -Math.tanh(raw[0]) * 50,
        roll: eyeRoll(face.landmarks),
      };
    });
  } finally {
    data.fill(0);
    canvas.width = canvas.height = 1;
  }
}

async function infer<T>(session: ort.InferenceSession, pixels: Float32Array, size: number, read: (outputs: ort.Tensor[]) => T) {
  const tensor = new ort.Tensor("float32", pixels, [1, 3, size, size]);
  try {
    const outputs = Object.values(await session.run({ [session.inputNames[0]]: tensor }));
    try { return read(outputs); }
    finally { for (const output of outputs) output.dispose(); }
  } finally {
    tensor.dispose();
    pixels.fill(0);
  }
}

function poseInput(data: Uint8ClampedArray, width: number, height: number, face: FaceDetection) {
  const [left, top, right, bottom] = face.box;
  const boxWidth = (right - left) * width, boxHeight = (bottom - top) * height;
  const side = Math.max(Math.trunc(boxWidth), Math.trunc(boxHeight));
  const padX = (side - boxWidth) / 2, padY = (side - boxHeight) / 2;
  // FaceEngine's SquareToBorder crop expands the shorter side and clips at the image edge.
  const x0 = Math.max(0, Math.trunc(left * width - padX)), y0 = Math.max(0, Math.trunc(top * height - padY));
  const x1 = Math.min(width, Math.trunc(right * width + padX)), y1 = Math.min(height, Math.trunc(bottom * height + padY));
  if (x1 <= x0 || y1 <= y0) return null;
  const xs = resizeAxisWeights(x1 - x0, POSE_SIZE), ys = resizeAxisWeights(y1 - y0, POSE_SIZE);
  const plane = POSE_SIZE * POSE_SIZE;
  const result = new Float32Array(3 * plane);
  for (let y = 0; y < POSE_SIZE; y++) {
    const vertical = ys[y];
    for (let x = 0; x < POSE_SIZE; x++) {
      const horizontal = xs[x];
      for (let channel = 0; channel < 3; channel++) {
        const sample = (row: number, column: number) => data[((y0 + row) * width + x0 + column) * 4 + channel];
        const a = Math.round((sample(vertical.left, horizontal.left) * vertical.a + sample(vertical.right, horizontal.left) * vertical.b) / vertical.scale);
        const b = Math.round((sample(vertical.left, horizontal.right) * vertical.a + sample(vertical.right, horizontal.right) * vertical.b) / vertical.scale);
        const pixel = Math.min(255, Math.round((a * horizontal.a + b * horizontal.b) / horizontal.scale));
        result[channel * plane + y * POSE_SIZE + x] = (pixel / 255 - 0.5) / 0.25;
      }
    }
  }
  return result;
}
