import { describe, expect, test } from "bun:test";
import {
  SIMULATION_CAPTURE_POLICY_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  validateFrameBundleV0,
} from "../../contracts/src";
import {
  buildFrameBundle,
  createSyntheticFixtureBundle,
  sha256Rgba8,
} from "../src";
import { metadataPolicy, ONE_HASH, testFrame, ZERO_HASH } from "./helpers";

describe("deterministic metadata artifact", () => {
  test("hashes exact RGBA8 bytes with a fixed vector", async () => {
    expect(await sha256Rgba8(testFrame())).toBe(
      "054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8",
    );
  });

  test("builds a validator-clean canonical bundle with a fixed digest", async () => {
    const bundle = await buildFrameBundle({
      sessionId: "session-test",
      policy: metadataPolicy,
      accountPublicMaterialDigestSha256: ZERO_HASH,
      nonceDigestSha256: ONE_HASH,
      frames: [
        {
          transportIndex: 0,
          width: 1,
          height: 1,
          encoding: "rgba8",
          byteLength: 4,
          frameDigestSha256:
            "054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8",
          captureOffsetMs: 0,
        },
      ],
    });
    expect(await validateFrameBundleV0(bundle, metadataPolicy)).toEqual([]);
    expect(bundle.artifactDigestSha256).toBe(
      "d696da0c10a6849c031511df738927d6a77fe3dd85103448407c953d0b02516f",
    );
  });

  test("synthetic fixture mode is explicit and consumes descriptors only", async () => {
    const policy = {
      ...metadataPolicy,
      version: SIMULATION_CAPTURE_POLICY_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      dataMode: "synthetic_fixture" as const,
    };
    const bundle = await createSyntheticFixtureBundle({
      testMode: true,
      fixtureId: "fixture-checkerboard-v1",
      policy,
      sessionId: "session-synthetic",
      accountPublicMaterialDigestSha256: ZERO_HASH,
      nonceDigestSha256: ONE_HASH,
      frames: [
        {
          width: 1,
          height: 1,
          byteLength: 4,
          frameDigestSha256: ZERO_HASH,
        },
      ],
    });
    expect(bundle.dataMode).toBe("synthetic_fixture");
    expect(bundle.syntheticFixtureId).toBe("fixture-checkerboard-v1");
    expect(Object.keys(bundle.frames[0] ?? {})).not.toContain("bytes");
  });
});
