import {
  computeFrameBundleDigestV0,
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  SIMULATION_MODE,
  validateFrameBundleV0,
  type FrameBundleV0,
  type FrameDescriptorV0,
  type HexSha256,
  type SimulationCapturePolicyV0,
} from "../../contracts/src";
import type { SyntheticFixtureRequest, TransientRgba8Frame } from "./types";

export async function sha256Rgba8(frame: TransientRgba8Frame): Promise<HexSha256> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    frame.bytes.buffer.slice(
      frame.bytes.byteOffset,
      frame.bytes.byteOffset + frame.bytes.byteLength,
    ) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function assertFrameWithinPolicy(
  frame: TransientRgba8Frame,
  policy: SimulationCapturePolicyV0,
): void {
  if (
    !Number.isSafeInteger(frame.width) ||
    !Number.isSafeInteger(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.width > policy.maxWidth ||
    frame.height > policy.maxHeight
  ) {
    throw new RangeError("Frame dimensions exceed the capture policy");
  }
  const expectedByteLength = frame.width * frame.height * 4;
  if (
    !Number.isSafeInteger(expectedByteLength) ||
    frame.bytes.byteLength !== expectedByteLength ||
    expectedByteLength > policy.maxFrameBytes
  ) {
    throw new RangeError("RGBA8 frame byte length exceeds the capture policy");
  }
}

export async function buildFrameBundle(
  fields: {
    readonly sessionId: string;
    readonly policy: SimulationCapturePolicyV0;
    readonly accountPublicMaterialDigestSha256: HexSha256;
    readonly nonceDigestSha256: HexSha256;
    readonly frames: readonly FrameDescriptorV0[];
    readonly syntheticFixtureId?: string;
  },
): Promise<FrameBundleV0> {
  const totalByteLength = fields.frames.reduce((sum, frame) => sum + frame.byteLength, 0);
  const pending: FrameBundleV0 = {
    kind: FRAME_BUNDLE_V0,
    mode: SIMULATION_MODE,
    sessionId: fields.sessionId,
    policyId: fields.policy.policyId,
    accountPublicMaterialDigestSha256: fields.accountPublicMaterialDigestSha256,
    nonceDigestSha256: fields.nonceDigestSha256,
    dataMode: fields.policy.dataMode,
    frames: fields.frames,
    ...(fields.syntheticFixtureId === undefined
      ? {}
      : { syntheticFixtureId: fields.syntheticFixtureId }),
    totalByteLength,
    digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
    artifactDigestSha256: "0".repeat(64),
  };
  const bundle = {
    ...pending,
    artifactDigestSha256: await computeFrameBundleDigestV0(pending),
  };
  const errors = await validateFrameBundleV0(bundle, fields.policy);
  if (errors.length > 0) throw new RangeError(`Invalid frame bundle: ${errors.join(",")}`);
  return bundle;
}

export async function createSyntheticFixtureBundle(
  request: SyntheticFixtureRequest,
): Promise<FrameBundleV0> {
  if (request.testMode !== true || request.policy.dataMode !== "synthetic_fixture") {
    throw new TypeError("Synthetic fixtures require explicit test mode and synthetic policy");
  }
  return buildFrameBundle({
    sessionId: request.sessionId,
    policy: request.policy,
    accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
    nonceDigestSha256: request.nonceDigestSha256,
    syntheticFixtureId: request.fixtureId,
    frames: request.frames.map((frame, transportIndex) => ({
      transportIndex,
      width: frame.width,
      height: frame.height,
      encoding: "rgba8",
      byteLength: frame.byteLength,
      frameDigestSha256: frame.frameDigestSha256,
      ...(frame.captureOffsetMs === undefined
        ? {}
        : { captureOffsetMs: frame.captureOffsetMs }),
    })),
  });
}
