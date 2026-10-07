export const LIVE_GUIDANCE_MODEL_V1 = Object.freeze({
  runtimePackage: "@mediapipe/tasks-vision",
  runtimeVersion: "1.0.1",
  modelKind: "MediaPipe Face Landmarker float16",
  modelPath: "/models/face_landmarker.task",
  modelSource:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  modelSha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  wasmBasePath: "/mediapipe",
  purpose: "ephemeral_capture_ux_only",
  securityDecision: false,
  sendsMeasurementsToServer: false,
} as const);
