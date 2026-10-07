import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  LiveFaceGuidanceControllerV1,
  classifyLiveFaceGuidanceV1,
  type NormalizedFacePointV1,
} from "../src/walkthrough/live-face-guidance";
import {
  CAPTURE_HOLD_DOT_COUNT_V1,
  captureHoldProgressV1,
} from "../src/walkthrough/hold-steady-progress";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

function face(options: {
  readonly centerX?: number;
  readonly centerY?: number;
  readonly width?: number;
  readonly height?: number;
  readonly noseOffsetRatio?: number;
} = {}): NormalizedFacePointV1[] {
  const centerX = options.centerX ?? 0.5;
  const centerY = options.centerY ?? 0.5;
  const width = options.width ?? 0.5;
  const height = options.height ?? 0.64;
  const points = Array.from({ length: 478 }, () => ({ x: centerX, y: centerY }));
  points[10] = { x: centerX, y: centerY - height / 2 };
  points[152] = { x: centerX, y: centerY + height / 2 };
  points[234] = { x: centerX - width / 2, y: centerY };
  points[454] = { x: centerX + width / 2, y: centerY };
  points[1] = {
    x: centerX + (options.noseOffsetRatio ?? 0) * width,
    y: centerY,
  };
  return points;
}

describe("ephemeral live face guidance", () => {
  test("fills exactly 64 progress dots during one continuous hold", () => {
    expect(CAPTURE_HOLD_DOT_COUNT_V1).toBe(64);
    expect(captureHoldProgressV1(0)).toBe(0);
    expect(captureHoldProgressV1(37.4)).toBe(0);
    expect(captureHoldProgressV1(37.5)).toBe(1 / 64);
    expect(captureHoldProgressV1(1_200)).toBe(0.5);
    expect(captureHoldProgressV1(2_400)).toBe(1);
    expect(captureHoldProgressV1(20_000)).toBe(1);
    expect(captureHoldProgressV1(Number.NaN)).toBe(0);
  });

  test("maps face count, distance, centering, pose, lighting, and ready states", () => {
    expect(classifyLiveFaceGuidanceV1([], 120).code).toBe("face_not_found");
    expect(classifyLiveFaceGuidanceV1([face(), face()], 120).code).toBe("multiple_faces");
    expect(classifyLiveFaceGuidanceV1([face({ width: 0.25, height: 0.4 })], 120).code)
      .toBe("move_closer");
    expect(classifyLiveFaceGuidanceV1([face({ width: 0.8, height: 0.8 })], 120).code)
      .toBe("move_farther");
    expect(classifyLiveFaceGuidanceV1([face({ centerX: 0.7 })], 120).code)
      .toBe("move_right");
    expect(classifyLiveFaceGuidanceV1([face({ centerX: 0.3 })], 120).code)
      .toBe("move_left");
    expect(classifyLiveFaceGuidanceV1([face({ centerY: 0.25 })], 120).code)
      .toBe("move_down");
    expect(classifyLiveFaceGuidanceV1([face({ centerY: 0.75 })], 120).code)
      .toBe("move_up");
    expect(classifyLiveFaceGuidanceV1([face({ noseOffsetRatio: -0.1 })], 120).code)
      .toBe("turn_left");
    expect(classifyLiveFaceGuidanceV1([face({ noseOffsetRatio: 0.1 })], 120).code)
      .toBe("turn_right");
    expect(classifyLiveFaceGuidanceV1([face()], 20).code).toBe("improve_lighting");
    expect(classifyLiveFaceGuidanceV1([face()], 240).code).toBe("reduce_lighting");
    expect(classifyLiveFaceGuidanceV1([face()], 120)).toEqual({
      code: "hold_steady",
      text: "Great position, hold steady",
    });
  });

  test("emits only a stable guidance code and closes the model on stop", async () => {
    const scheduled: FrameRequestCallback[] = [];
    const results: string[] = [];
    let closed = 0;
    let timestamp = 0;
    const video = {
      readyState: 2,
      currentTime: 1,
      videoWidth: 640,
      videoHeight: 480,
    } as HTMLVideoElement;
    const controller = new LiveFaceGuidanceControllerV1(
      () => video,
      (result) => results.push(result.code),
      {
        createLandmarker: async () => ({
          detectForVideo: () => ({ faceLandmarks: [face()] }),
          close: () => { closed += 1; },
        }),
        requestFrame: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        cancelFrame: () => undefined,
        now: () => ++timestamp * 200,
        readMeanLuma: () => 120,
        minimumIntervalMs: 0,
      },
    );

    controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(results).toEqual(["loading"]);
    scheduled.shift()?.(timestamp);
    video.currentTime = 2;
    scheduled.shift()?.(timestamp);
    expect(results).toEqual(["loading", "hold_steady"]);
    video.currentTime = 3;
    scheduled.shift()?.(timestamp);
    expect(results).toEqual(["loading", "hold_steady"]);
    controller.stop();
    expect(closed).toBe(1);
    expect(Object.keys({ code: results.at(-1) })).toEqual(["code"]);
  });
});
