# FacePAD PoseGuard source

This is the FacePAD research implementation, not a port of the `POSE_GUARD` configuration in [app-backend-app-config at 114978ef](https://github.com/worldcoin/app-backend-app-config/blob/114978ef1b4b109f380a4c350c0fe10cd20845b0/face-auth-config/default.ts#L80). That configuration specifies three consecutive successes, pose ranges/tolerances, similarity thresholds and a different timeout/retry policy. This vendored core implements four directions and an iris/gaze decision; its values cannot be replaced one-for-one with that configuration.

Upstream: https://github.com/worldcoin/face-pad/tree/e5d90133c0d24a89087f97594a8a00dcc8bdd318

- `packages/poseguard/src/vendor/posechallenge.js` is an unmodified copy of `web/static/core/posechallenge.js` (algorithm 8). No thresholds, target generation, gaze checks or outcomes are changed.
- `packages/poseguard/src/vendor/geometry.js` is an unmodified copy of `web/static/lib/geometry.js`.
- `packages/poseguard/src/vendor/lightanalyzer.js` contains the verbatim fdlibm `hypot` section (upstream lines 20–96). Its source comments credit OpenJDK FdLibm.Hypot.
- `packages/poseguard/src/vendor/planar.js` contains the verbatim `median` and `solve` section (upstream lines 198–235).
- TypeScript declarations and the worker adapter are local integration code.
- `web/test/poseguard-core.test.js` adapts upstream `web/tools/posetest.mjs` to Bun's test runner; assertions and synthetic scenarios are preserved.

No standalone root LICENSE file was available at this upstream commit; no new license is asserted for the vendored source. Original source comments are retained. MediaPipe's runtime/model licensing remains with its upstream distribution and package notices.

Runtime: `@mediapipe/tasks-vision@1.0.1`. Model: official `face_landmarker/face_landmarker/float16/1/face_landmarker.task`, SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`, matching FacePAD's `web/serve.py`.

The API issues the seed and replays the same unchanged core before the UI can complete. The browser submits relative timestamps, head angles, presence, dimensions and six eye-landmark x/y pairs. Neither images nor the full face mesh are uploaded. Both runtimes reconstruct the same minimal observations; nose-parallax diagnostics are unavailable, and are not used by algorithm 8's decision. No measurement or aggregate console logging is enabled.

These remain browser-supplied measurements. API replay cannot prove camera provenance or stop a modified client from manufacturing a passing trace. A verdict is not enclave authorization, a credential, or a proof. See [the integration boundary](../../../docs/poseguard.md).

The adapter analyzes the unmirrored oval-preview crop at 720 pixels wide, using transferred ImageBitmaps and at most 20 observations per second. FacePAD's reference uses upright full-frame ImageData. These integration differences have not yet been validated against representative human recordings. Only the displayed camera preview is mirrored.

