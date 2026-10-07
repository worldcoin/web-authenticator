import type { HexSha256, Identifier } from "./common";
import { canonicalizeJsonV0, isHexSha256, isRecord, SIMULATION_MODE } from "./common";
import type {
  FrameArtifactDataModeV0,
  SimulationCapturePolicyV0,
} from "./simulation-capture-policy-v0";

export const FRAME_BUNDLE_V0 = "frame_bundle_v0" as const;
export const FRAME_BUNDLE_V0_DIGEST_ALGORITHM = "sha256_rfc8785_jcs" as const;

export interface FrameDescriptorV0 {
  readonly transportIndex: number;
  readonly width: number;
  readonly height: number;
  readonly encoding: "rgba8";
  readonly byteLength: number;
  readonly frameDigestSha256: HexSha256;
  readonly captureOffsetMs?: number;
}

export interface FrameBundleV0 {
  readonly kind: typeof FRAME_BUNDLE_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly sessionId: Identifier;
  readonly policyId: Identifier;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly nonceDigestSha256: HexSha256;
  readonly dataMode: FrameArtifactDataModeV0;
  readonly frames: readonly FrameDescriptorV0[];
  readonly syntheticFixtureId?: Identifier;
  readonly totalByteLength: number;
  readonly digestAlgorithm: typeof FRAME_BUNDLE_V0_DIGEST_ALGORITHM;
  readonly artifactDigestSha256: HexSha256;
}

export async function validateFrameBundleV0(
  value: unknown,
  policy: SimulationCapturePolicyV0,
): Promise<readonly string[]> {
  const errors: string[] = [];
  if (!isRecord(value)) return ["bundleType"];
  const bundle = value as unknown as FrameBundleV0;
  const allowedBundleKeys = new Set([
    "kind",
    "mode",
    "sessionId",
    "policyId",
    "accountPublicMaterialDigestSha256",
    "nonceDigestSha256",
    "dataMode",
    "frames",
    "syntheticFixtureId",
    "totalByteLength",
    "digestAlgorithm",
    "artifactDigestSha256",
  ]);
  for (const key of Object.keys(bundle)) {
    if (!allowedBundleKeys.has(key)) errors.push(`unknown.${key}`);
  }
  if (bundle.kind !== FRAME_BUNDLE_V0) errors.push("kind");
  if (bundle.mode !== SIMULATION_MODE) errors.push("mode");
  if (typeof bundle.sessionId !== "string" || !bundle.sessionId) errors.push("sessionId");
  if (bundle.policyId !== policy.policyId) errors.push("policyId");
  if (bundle.dataMode !== policy.dataMode) errors.push("dataMode");
  if (bundle.digestAlgorithm !== FRAME_BUNDLE_V0_DIGEST_ALGORITHM) {
    errors.push("digestAlgorithm");
  }
  if (!isHexSha256(bundle.accountPublicMaterialDigestSha256)) errors.push("accountDigest");
  if (!isHexSha256(bundle.nonceDigestSha256)) errors.push("nonceDigest");
  if (!isHexSha256(bundle.artifactDigestSha256)) errors.push("artifactDigest");
  if (!Array.isArray(bundle.frames)) return [...errors, "framesType"];
  if (bundle.frames.length < policy.minFrames || bundle.frames.length > policy.maxFrames) {
    errors.push("frameCount");
  }
  if (bundle.totalByteLength > policy.maxTotalBytes || bundle.totalByteLength < 0) {
    errors.push("totalByteLength");
  }
  if (!Number.isSafeInteger(bundle.totalByteLength)) errors.push("totalByteLengthType");
  if (bundle.dataMode === "synthetic_fixture" && !bundle.syntheticFixtureId) {
    errors.push("syntheticFixtureId");
  }
  if (bundle.dataMode === "metadata_only" && bundle.syntheticFixtureId !== undefined) {
    errors.push("unexpectedSyntheticFixtureId");
  }

  let computedByteLength = 0;
  bundle.frames.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push(`frames[${index}].type`);
      return;
    }
    const frame = candidate as unknown as FrameDescriptorV0;
    const allowedFrameKeys = new Set([
      "transportIndex",
      "width",
      "height",
      "encoding",
      "byteLength",
      "frameDigestSha256",
      "captureOffsetMs",
    ]);
    for (const key of Object.keys(frame)) {
      if (!allowedFrameKeys.has(key)) errors.push(`frames[${index}].unknown.${key}`);
    }
    if (frame.transportIndex !== index) errors.push(`frames[${index}].transportIndex`);
    if (!Number.isSafeInteger(frame.transportIndex)) errors.push(`frames[${index}].indexType`);
    if (frame.encoding !== policy.encoding) errors.push(`frames[${index}].encoding`);
    if (frame.width <= 0 || frame.width > policy.maxWidth) errors.push(`frames[${index}].width`);
    if (!Number.isSafeInteger(frame.width)) errors.push(`frames[${index}].widthType`);
    if (frame.height <= 0 || frame.height > policy.maxHeight) {
      errors.push(`frames[${index}].height`);
    }
    if (!Number.isSafeInteger(frame.height)) errors.push(`frames[${index}].heightType`);
    if (frame.byteLength < 0 || frame.byteLength > policy.maxFrameBytes) {
      errors.push(`frames[${index}].byteLength`);
    }
    if (!Number.isSafeInteger(frame.byteLength)) errors.push(`frames[${index}].byteLengthType`);
    if (frame.captureOffsetMs !== undefined && !Number.isSafeInteger(frame.captureOffsetMs)) {
      errors.push(`frames[${index}].captureOffsetType`);
    }
    if (!isHexSha256(frame.frameDigestSha256)) errors.push(`frames[${index}].digest`);
    computedByteLength += frame.byteLength;
  });

  if (computedByteLength !== bundle.totalByteLength) errors.push("byteLengthSum");
  try {
    if (await computeFrameBundleDigestV0(bundle) !== bundle.artifactDigestSha256) {
      errors.push("artifactDigestMismatch");
    }
  } catch {
    errors.push("artifactCanonicalization");
  }
  return errors;
}

export function canonicalFrameBundlePreimageV0(bundle: FrameBundleV0): string {
  const { artifactDigestSha256: _omitted, ...preimage } = bundle;
  return canonicalizeJsonV0(preimage);
}

export async function computeFrameBundleDigestV0(bundle: FrameBundleV0): Promise<HexSha256> {
  const bytes = new TextEncoder().encode(canonicalFrameBundlePreimageV0(bundle));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// FrameBundleV0 contains descriptors and digests only. It has no camera-byte field.
