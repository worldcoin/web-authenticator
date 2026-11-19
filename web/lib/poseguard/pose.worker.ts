import { FaceLandmarker } from "@mediapipe/tasks-vision";
import loader from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import binary from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import { POSE_GUARD_MODEL_URL } from "../../../config/environment";
import type { PoseObservation, PoseWorkerRequest, PoseWorkerResponse } from "./types";

const MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";
let detector: FaceLandmarker | undefined;

self.onmessage = async ({ data }: MessageEvent<PoseWorkerRequest>) => {
  const send = (response: PoseWorkerResponse) => self.postMessage(response);
  try {
    if (data.type === "init") {
      detector = await createDetector();
      send({ type: "ready" });
    } else {
      try {
        if (!detector) throw new Error("Pose detector is not ready.");
        send({ type: "result", pose: observe(detector.detectForVideo(data.frame, data.timestamp)) });
      } finally {
        data.frame.close();
      }
    }
  } catch {
    send({ type: "error", message: data.type === "init" ? "Could not load the head-pose model." : "Could not estimate head pose." });
  }
};

async function createDetector(): Promise<FaceLandmarker> {
  const response = await fetch(POSE_GUARD_MODEL_URL, {
    credentials: "omit", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Head-pose model was unavailable.");
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== MODEL_SHA256) throw new Error("Head-pose model integrity check failed.");
  return FaceLandmarker.createFromOptions({
    wasmLoaderPath: new URL(loader, self.location.href).href,
    wasmBinaryPath: new URL(binary, self.location.href).href,
  }, {
    baseOptions: { modelAssetBuffer: new Uint8Array(bytes), delegate: "CPU" },
    canvas: new OffscreenCanvas(1, 1),
    runningMode: "VIDEO",
    numFaces: 2,
    outputFacialTransformationMatrixes: true,
  });
}

function observe(result: ReturnType<FaceLandmarker["detectForVideo"]>): PoseObservation | null {
  if (result.faceLandmarks.length !== 1) return null;
  const matrix = result.facialTransformationMatrixes[0]?.data;
  if (!matrix || matrix.length !== 16 || !matrix.every(Number.isFinite)) return null;
  // As in the PoseGuard demo, use the matrix's forward axis in the unmirrored frame.
  const columnMajor = Math.abs(matrix[3]) + Math.abs(matrix[7]) + Math.abs(matrix[11]) < 1e-6;
  const x = matrix[columnMajor ? 8 : 2], y = matrix[columnMajor ? 9 : 6], z = matrix[10];
  if (Math.hypot(x, y, z) < 1e-6) return null;
  const face = result.faceLandmarks[0];
  const xs = face.map(point => point.x), ys = face.map(point => point.y);
  return {
    yaw: Math.atan2(x, z) * 180 / Math.PI,
    pitch: Math.atan2(-y, Math.hypot(x, z)) * 180 / Math.PI,
    left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
  };
}
