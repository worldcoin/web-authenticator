# RGBNet browser demo

`/selfie-demo` runs RGBNet locally in a dedicated Web Worker, draws a mirrored face
box and five landmarks, and supplies positioning guidance. Unlock the existing
authenticator first. Other camera flows remain preview-only. Positioning does not
establish image quality, identity, eye tracking or liveness; synthetic enrollment
and the unconnected TEE transport are unchanged.

## Model setup

```sh
bun install
bun scripts/setup-rgbnet.ts /path/to/RGBNet.onnx
bun run dev
```

Open `http://localhost:3100/selfie-demo`. The setup script installs only the detector
in `public/models/rgbnet.onnx`, after checking its byte length and SHA-256 against
`src/components/selfie-check/rgbnet-model.json`. The worker repeats these checks.
The model file is ignored by Git: install it before building a deployable demo.
No Hugging Face token or other model is included in the browser bundle.

The initial artifact came from the local `world-app-ios` checkout at
`Sources/FaceAuthLibrary/Sources/FaceEngineFaceAuthModel/MLModels/RGBNet.onnx`.
That file's last change is commit `f468fbf5330b44604a803c7a39b542f50f0dd345`
(Face Engine 2.18.2 update). Its SHA-256 is
`35e9bdee626e16721e4566d1e552ad369d8334658b7893ee62cf3a026f1c0d06`.
This is an explicit artifact pin, not a claim that it matches the recommended
2.20.0 Hugging Face revision; that mapping still requires authenticated access.

## Processing and language choice

`rgbnet.ts` implements RGBNet's 256×256 fixed-kernel bilinear resize, RGB channel
mean subtraction, NCHW layout, 2,688 anchors, box/landmark decoding, confidence
threshold 0.8 and pixel-space NMS threshold 0.4. The resize reproduces the native
vertical-first u8 rounding and quantized filter weights; browser Canvas scaling
is deliberately not used for resizing. Canvas only extracts original pixels.

The reference is `worldcoin/biometric-engines` commit
`5bd0d4650e2e9b45af4f445dfcff35a9630a139f`, specifically
`face_engine/src/nodes/detection/{rgbnet_detector,nms}.rs` and
`utils/src/image/operations/affine.rs`.

Keep this small adapter in TypeScript for the demo. ONNX Runtime Web 1.30.0 already
executes inference with its Wasm CPU backend, SIMD and one thread, without requiring
cross-origin isolation. Compiling all of Face Engine into Wasm is unnecessary for
this detector. If we later share the full QA pipeline, extract a maintained Rust
processing library usable by both native and Wasm targets instead of duplicating
more of Face Engine in TypeScript. Compiling Rust to browser Wasm would still be
client-side execution; authoritative checks belong in the TEE.

## Diagnostics and failure behavior

- The demo log reports download, hash verification, session creation, warm-up,
  readiness, timing summaries every two seconds, failures and worker termination.
- The checked **Detailed ONNX logs in browser console** toggle enables ONNX's
  verbose initialization/graph logs plus every frame's extraction, preprocessing,
  inference, decoding and tensor/bitmap disposal. Changing it restarts the worker.
  ONNX's own Wasm logger can write informational messages to console.error; use
  its `[I:onnxruntime]` / `[V:onnxruntime]` / `[E:onnxruntime]` severity prefix.
- Application diagnostics contain timings and model/runtime metadata, never
  frames, tensors, boxes, landmarks, embeddings or credentials. Logs stay local.
- Only one frame can be in flight. Completion schedules the next capture after
  100 ms. Frames are never queued. Startup has a 45-second deadline, fetching a
  20-second deadline, and capture/inference a 10-second deadline. A stalled camera
  also fails after 10 seconds. Failure clears the overlay and exposes retry.
- Unmounting, camera interruption or hiding the tab terminates the detector worker.
  Worker termination releases its Wasm session even if inference is hung.

## Validation

`bun test tests/rgbnet.test.ts` checks native reference fixtures, malformed model
outputs, confidence filtering and mirrored object-cover geometry. Existing camera
tests cover camera cancellation and hidden-tab cleanup.

`tests/fixtures/rgbnet-resize.json` contains SHA-256 hashes of little-endian f32
tensors produced by native `fast_image_resize` 5.5.0 using
`ResizeAlg::Interpolation(FilterType::Bilinear)`, `PixelType::U8x3`, then RGB means
`[104,117,123]` and NCHW layout. Input RGBA byte `i` is
`(i * 37 + floor(i / 13)) % 256`; alpha is ignored. Sizes cover identity, portrait,
landscape, upsampling and non-integral scale ratios.

`tests/fixtures/rgbnet-decode.json` supplies sparse nonzero output rows and the
expected detections produced by the native Rust RGBNet decode/filter methods and
NMS from the pinned commit. Other rows are zero. This checks the processing
functions, not the full Face Engine pipeline.

Agent-run Chromium checks additionally exercised actual model inference, missing
model/retry, worker cleanup, and the overlay at desktop/mobile viewport sizes.
On the public scikit-image astronaut sample, browser inference with this TS adapter
and native ONNX Runtime with the Rust reference processing found one face;
maximum normalized box/landmark difference was about `5.96e-8`. This is a regression
comparison on one image, not a biometric accuracy or mobile performance evaluation.

The distributed ONNX Wasm asset is about 14.2 MB uncompressed (3.7 MB gzip), plus
the 1.7 MB model. The worker loads only when face detection is enabled. Serve
compressed, cacheable assets when deploying the demo.
