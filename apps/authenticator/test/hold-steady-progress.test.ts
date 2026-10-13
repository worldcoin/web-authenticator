import { expect, test } from "bun:test";
import { CAPTURE_HOLD_DOT_COUNT_V1, captureHoldProgressV1 } from "../src/walkthrough/hold-steady-progress";

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
