import { describe, expect, test } from "bun:test";
import { boundedRgbaDimensions } from "../src";
import { metadataPolicy } from "./helpers";

describe("browser frame geometry", () => {
  test("deterministically preserves aspect ratio within dimensions and RGBA8 bytes", () => {
    const dimensions = boundedRgbaDimensions(1920, 1080, {
      ...metadataPolicy,
      maxWidth: 640,
      maxHeight: 640,
      maxFrameBytes: 640 * 360 * 4,
    });
    expect(dimensions).toEqual({ width: 640, height: 360 });
    expect(dimensions.width * dimensions.height * 4).toBeLessThanOrEqual(640 * 360 * 4);
  });

  test("uses sampled source geometry and rejects missing intrinsic dimensions", () => {
    expect(() => boundedRgbaDimensions(0, 1080, metadataPolicy)).toThrow(RangeError);
    expect(
      boundedRgbaDimensions(4, 4, { ...metadataPolicy, maxFrameBytes: 16 }),
    ).toEqual({ width: 2, height: 2 });
  });
});
