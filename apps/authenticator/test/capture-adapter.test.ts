import { describe, expect, test } from "bun:test";
import {
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  SIMULATION_MODE,
  SIMULATOR_UI_QUALITY_POLICY_V0,
  type FrameBundleV0,
  type SimulationCapturePolicyV0,
} from "@clean-start/contracts";
import type { CaptureRequest, CaptureRuntimeOptions } from "@clean-start/frame-capture";
import { BrowserMetadataCaptureAdapterV1 } from "../src/adapters/browser-capture";

const policy: SimulationCapturePolicyV0 = {
  version: "simulation_capture_policy_v0",
  mode: "simulation",
  environment: "staging",
  policyId: "cs5-metadata-camera-active-v0",
  dataMode: "metadata_only",
  encoding: "rgba8",
  minFrames: 1,
  maxFrames: 2,
  maxWidth: 1024,
  maxHeight: 1024,
  maxFrameBytes: 4_194_304,
  maxTotalBytes: 8_388_608,
  captureOffsetsAreDiagnosticOnly: true,
  arrayOrderHasBiometricMeaning: false,
  qualityPolicyId: SIMULATOR_UI_QUALITY_POLICY_V0.policyId,
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("W04/W05 browser capture adapter", () => {
  test("waits for the explicit metadata action and emits only a FrameBundle", async () => {
    let captureRequest: CaptureRequest | undefined;
    let runtimeOptions: CaptureRuntimeOptions | undefined;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const bundle: FrameBundleV0 = {
      kind: FRAME_BUNDLE_V0,
      mode: SIMULATION_MODE,
      sessionId: "session",
      policyId: policy.policyId,
      accountPublicMaterialDigestSha256: "a".repeat(64),
      nonceDigestSha256: "b".repeat(64),
      dataMode: "metadata_only",
      frames: [{
        transportIndex: 0,
        width: 1,
        height: 1,
        encoding: "rgba8",
        byteLength: 4,
        frameDigestSha256: "c".repeat(64),
      }],
      totalByteLength: 4,
      digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
      artifactDigestSha256: "d".repeat(64),
    };
    const states: string[] = [];
    const quality: string[] = [];
    let artifact: FrameBundleV0 | undefined;
    const adapter = new BrowserMetadataCaptureAdapterV1({
      runtimeFactory(options) {
        runtimeOptions = options;
        return {
          async capture(request) {
            captureRequest = request;
            options.onStateChange?.("acquiring");
            options.onStateChange?.("awaiting_first_frame");
            options.onStateChange?.("preview");
            await request.inspectTransientFrame?.({
              width: 1,
              height: 1,
              bytes: new Uint8ClampedArray([1, 2, 3, 4]),
            });
            return bundle;
          },
          cancel() {},
          unmount() {},
        };
      },
    });

    adapter.start({
      entry: {
        userActivated: true,
        secureTopLevelContextApproved: true,
        prfReady: true,
        iosMajor: 18,
        browser: "safari",
      },
      policy,
      qualityPolicy: SIMULATOR_UI_QUALITY_POLICY_V0,
      sessionId: "session",
      accountPublicMaterialDigestSha256: "a".repeat(64),
      nonceDigestSha256: "b".repeat(64),
      retakesUsed: 0,
    }, {
      onCaptureState(state) { states.push(state); },
      onQuality(result) { quality.push(result.action); },
      onArtifactReady(value) { artifact = value; },
      onFailure() {},
      onComplete() { resolveDone(); },
    });
    await Promise.resolve();
    expect(states).toEqual(["acquiring", "awaiting_first_frame", "preview"]);
    expect(quality).toEqual([]);

    adapter.requestMetadataCollection();
    await done;
    expect(quality).toEqual(["ready"]);
    expect(artifact).toBe(bundle);
    expect(captureRequest?.policy.dataMode).toBe("metadata_only");
    expect(runtimeOptions).toBeDefined();
  });
});
