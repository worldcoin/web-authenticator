# Browser capture and short challenge plan

Status: proposed implementation, not an implemented liveness or issuance flow.

## Existing capability

`/selfie-demo` has local RGBNet inference, face boxes/landmarks, positioning guidance,
runtime diagnostics and worker lifecycle handling. The detector does not record a
sequence. `connect()` is still a stub: it does not verify attestation, establish an
enclave session or upload captures. Credential issuance currently uses synthetic
face data.

## Browser models and source of the decision

[Tobi, October 2](https://tfh.enterprise.slack.com/archives/C0ARSRLVCV7/p1790981917899729)
said face detection and QA models were acceptable in the open from the team's
perspective, except the TFH occlusion model. This is category-level guidance, not
an individually enumerated artifact approval or a claim of completed security review.
He also said the team did not have capacity to support Face Engine Wasm compilation.

Mapping the QA category to the
[2.20.0 configuration](https://github.com/worldcoin/app-backend-app-config/blob/main/face-auth-config/face-engine/ios/default/deepFace/2.20.0.yaml):

| Model                        | Config node               | Browser purpose                                                                                          |
| ---------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| RGBNet                       | RGBNet                    | Locate face and five alignment landmarks; already integrated.                                            |
| HeadPose                     | HeadPoseModel             | Estimate yaw, pitch and roll; frontal capture guidance and measurements for a new head-motion evaluator. |
| FaceExpressionNeutrality     | ExpressionNeutralityModel | Neutral expression / closed-eye quality feedback.                                                        |
| FaceImageQuality (LightQNet) | LightQNet                 | Face image quality score; not LightGuard and not a liveness verdict.                                     |
| External glasses detector    | Separate browser adapter  | Early glasses feedback; does not replace full TEE occlusion checks.                                      |

[Gabi, September 8](https://tfh.enterprise.slack.com/archives/C0ARSRLVCV7/p1788863153310809)
explicitly discussed pose, expression and LightQNet. She noted LightQNet's public
MIT weights and the need to distribute the license/notice with the ONNX artifact.
[Tobi, October 5](https://tfh.enterprise.slack.com/archives/C0ARSRLVCV7/p1791222799827129)
recommended a lightweight glasses detector, following
[Ashima's comparison](https://tfh.enterprise.slack.com/archives/C0ARSRLVCV7/p1790634973889309)
of `mantasu/glasses-detector`. Its exact variant/export remains to be pinned.

Exposure, sharpness, lighting, contrast, color and bounding-box checks also need
reproduction; many are deterministic image-processing routines, not additional
models. The relevant crop/alignment and thresholds matter as much as the weights.
The cited config is deepFace: enrollment must use its appropriate approved config,
not silently adopt verification settings. Resolve the existing RGBNet artifact's
release mapping before establishing the final shared browser/TEE model manifest.

Keep TFH FaceOcclusion, FaceSpoofClassifier/FAS and embedding generation inside the
TEE. Do not infer permission for every model in the release manifest (for example
MeshLandmarks, MeshExpressions or LightGuard) from their presence in that manifest.

## First challenge proposal

Use a small head turn, then return to center, with a target of **three seconds of
capture**. The server/TEE selects direction, a bounded target angle and cue timing.
Start with approximately 10–15 degrees of horizontal movement, to be calibrated
against users/devices before setting acceptance thresholds. Display a moving target
with the instruction to turn the head toward it; an eyes-only dot-following task
cannot be scored with HeadPose.

This deliberately uses the existing pose measurement model. Sequence scoring is
new deterministic code: establish a frontal pose reference, detect the requested
signed yaw change in order, then detect return to center. Allow a measured reaction
window and reject insufficient evidence. Pose QA for a neutral enrollment frame
must not reject the very movement requested by the challenge; use separate rules
for reference frames and challenge-response frames without relaxing spoof policy.

Random direction/angle/timing has limited human-action entropy. A 128-bit session
nonce does not turn a left/right action into a 128-bit liveness proof. Evaluate this
as challenge compliance plus the existing FAS pipeline, not established resistance
to injected or generated video. The previous Slack agreement was static FAS in the
TEE, not an already-supported active gaze/head challenge.

## Capture sequence

1. On camera startup, load models and prepare verified TEE access concurrently.
   Show positioning/quality guidance. No challenge timer runs during model download
   or camera permission. Track those delays separately in total user time.
2. Require one usable, front-facing face and a ready capture pipeline. Reserve a
   bounded in-memory capture buffer. Avoid multi-point gaze calibration. Measure
   how long readiness takes instead of promising a fixed 500 ms.
3. Once ready, obtain a fresh challenge from the verifier. Bind its one-time ID,
   random nonce, action parameters, policy version and expiry to the enclave session,
   credential subject and enrollment/request ID. The enclave must originate or
   authenticate this challenge; an arbitrary browser-supplied challenge is invalid.
4. Start sampling before displaying the first movement cue. Use one monotonic clock
   for actual cue presentation times and frame receipt times, also recording video
   media timestamps and contiguous sequence numbers. These are client claims, not
   trusted proof of camera origin or time. Continue sampling during cue display and
   return to center; stop at the bounded deadline.
5. Encrypt the capture and manifest to the verified enclave key. Submit, evaluate
   and show the result. Erase transient frames after completion, failure or cancel;
   a retry receives a new challenge rather than reusing prior evidence.

Proposed initial transport: **ordered JPEG frames**, not a live video codec stack.
Target 10 frames/second for three seconds (about 30 frames), initially 640×480 for
motion evaluation. Preserve a full-resolution frontal frame from the same capture
for enrollment QA/embedding. Validate this resolution/cadence against the actual
model contract and device performance. Set hard count, encoded-byte, decoded-pixel
and duration limits on both ends; initial demo budgets can be 40 motion frames and
8 MiB total including the reference frame. These are starting budgets, not measured
bandwidth or security guarantees.

JPEG sampling reuses single-image decoding in the worker and avoids introducing
WebRTC/video decoding. It costs more bandwidth than a compressed video; measure
total encode/upload time before committing to production. Start with one bounded
encrypted batch. Add authenticated chunked upload during capture only if measured
latency requires it; do not add a second transport for the initial demo.

Capture sampling and cue animation must not wait for local model inference. The
capture coordinator owns frames/times; the inference worker consumes selected
frames with backpressure. If sampling/encoding cannot keep up, record gaps and fail
the attempt according to policy; never fabricate timestamps or queue indefinitely.

## TEE evaluation and binding

- Authenticate the challenge/session and subject/request binding; enforce expiry,
  one-time consumption and replay protection at the verifier.
- Validate and bound payloads before decoding; verify frame count/order, decode
  limits and submitted capture-manifest integrity. Client metadata remains untrusted.
- Run the correct native Face Engine QA, occlusion and FAS policy. Evaluate the
  pose sequence against the server-selected task using measurements from received
  images, never browser-reported scores. Existing single-image worker operations
  require a new sequence orchestrator for this task.
- Check face continuity across the challenge/reference frames under an explicit
  policy; do not let a good unrelated still satisfy the enrollment part of a clip.
- Produce evidence binding the result, challenge, subject/request, capture digest,
  model/config/policy versions and protected enrollment outputs. The issuer must
  verify that binding before credential issuance.

An encrypted channel and challenge binding protect routing and replay semantics;
they cannot establish that an untrusted browser supplied authentic live-camera
pixels. Spoof/injection evaluation remains a separate acceptance requirement.

## Implementation order and acceptance

1. Pin compatible artifacts/configs. Add HeadPose, expression and quality feedback,
   with the needed non-model QA and model-specific crops/normalization. Use native
   reference fixtures for each adapter and include required model notices.
2. Add a capture coordinator and head-turn UI with bounded frame storage, timestamps,
   visible cancel/retry and privacy-safe stage/timing logs. Until the backend exists,
   explicitly label any challenge generated by the local demo server as development
   only; it cannot authorize a credential.
3. Implement real attestation/session setup, challenge issuance and encrypted capture
   submission in the browser and di-migration-tee.
4. Add native sequence evaluation, continuity checks, policy-specific QA/FAS, and
   evidence verification/issuance integration. Test wrong order, wrong direction,
   missing frames, replay, subject/request substitution and cross-session evidence.
5. Measure cold/warm readiness, challenge duration, encoding, upload, enclave
   evaluation and issuance separately on target phones. Validate genuine-user success
   and spoof/injection resistance before treating this as a production liveness flow.

The three-second clip is a UX target. Total completion includes setup and verification
and must be measured against an agreed CAPTCHA baseline; no existing measurement
establishes that the full flow meets the earlier CAPTCHA-plus-three-seconds budget.
