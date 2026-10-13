# RGBNet camera guidance

The optional camera preview uses Face Engine’s RGBNet detector via
`onnxruntime-web` 1.30.0 in a dedicated worker (WASM CPU, SIMD, one thread).
This replaces MediaPipe Face Landmarker. RGBNet emits face boxes, confidence and
five landmarks; the UI uses boxes for face count, centering and distance, with two
consecutive matching results before changing instructions. These are positioning
heuristics, not identity, eye tracking, head-pose or liveness verification.

Camera guidance does not gate passkey setup, synthetic staging issuance or RP
proof generation. Camera frames are not sent to the server. TEE validation remains
unconnected. A detector error leaves the camera preview available with an explicit
error; close and reopen it to retry.

## Setup

```sh
bun install --frozen-lockfile
bun scripts/setup-rgbnet.ts /path/to/RGBNet.onnx
bun run dev
```

The setup script installs `apps/authenticator/public/models/rgbnet.onnx` after
checking its 1,720,022-byte size and SHA-256 against `src/face/rgbnet-model.json`
inside the authenticator app. The worker repeats those checks before inference.
Model weights are ignored by Git; install them before building a deployed preview.
Without them, the preview reports a model-download failure; wallet/proof operations
remain available. CI without model weights skips only the actual inference test;
the missing-model, processing and lifecycle checks still run.

The artifact comes from `world-app-ios` at
`Sources/FaceAuthLibrary/Sources/FaceEngineFaceAuthModel/MLModels/RGBNet.onnx`,
last changed at `f468fbf5330b44604a803c7a39b542f50f0dd345` (Face Engine 2.18.2).
SHA-256: `35e9bdee626e16721e4566d1e552ad369d8334658b7893ee62cf3a026f1c0d06`.
This is the existing local demo’s artifact pin, not a claim of matching a newer
Hugging Face revision.

## Processing and lifecycle

The TypeScript preprocessing/decoder is ported from the existing demo, based on
`worldcoin/biometric-engines` commit `5bd0d4650e2e9b45af4f445dfcff35a9630a139f`:
`face_engine/src/nodes/detection/{rgbnet_detector,nms}.rs` and
`utils/src/image/operations/affine.rs`. It resizes to 256×256 with native-compatible
bilinear rounding, subtracts RGB means, builds an NCHW tensor, decodes 2,688 anchors,
filters at confidence >0.8 and applies pixel-space NMS at 0.4.

The mirrored object-cover projection accounts for the actual oval preview aspect
ratio. The worker receives at most one frame at a time; another frame is captured
100 ms after completion, with no video queue. Downloads have a 20-second deadline,
startup 45 seconds, and capture/inference 10 seconds. Closing or hiding the preview
terminates the worker and camera tracks. Extracted pixels and input tensors are
cleared after use, and bitmaps and tensors are released.

The preview’s **ONNX processing status** disclosure shows startup stages and
periodic extraction/preprocessing/inference/decoding timings. It never displays
frames, tensors, landmarks or embeddings. Per-frame diagnostic traces are disabled
by default. Runtime assets are bundled and served from the same origin; no model
token or external model CDN is used. [ONNX Runtime configuration reference](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).

## Checks

Ported native reference fixtures validate resize tensor hashes and decoded boxes,
landmarks and suppression. Unit tests also cover malformed outputs, projection,
worker cancellation and deadlines. Browser tests exercise the built worker with
the pinned model on a blank frame and reject missing model downloads. These checks
do not establish biometric accuracy or mobile performance.
