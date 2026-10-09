import model from "../face/rgbnet-model.json";

export const LIVE_GUIDANCE_MODEL_V1 = Object.freeze({
  runtimePackage: "onnxruntime-web",
  runtimeVersion: "1.30.0",
  modelKind: "Face Engine RGBNet face detector",
  modelPath: model.url,
  modelSource: model.source,
  modelSha256: model.sha256,
  purpose: "ephemeral_capture_ux_only",
  securityDecision: false,
  sendsMeasurementsToServer: false,
} as const);
