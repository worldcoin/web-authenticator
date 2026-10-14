export const CAPTURE_HOLD_DURATION_MS_V1 = 2_400;
export const CAPTURE_HOLD_DOT_COUNT_V1 = 64;
export const CAPTURE_COMPLETE_ACK_MS_V1 = 450;

export function captureHoldProgressV1(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const completedDots = Math.min(
    CAPTURE_HOLD_DOT_COUNT_V1,
    Math.floor(
      (elapsedMs / CAPTURE_HOLD_DURATION_MS_V1) * CAPTURE_HOLD_DOT_COUNT_V1,
    ),
  );
  return completedDots / CAPTURE_HOLD_DOT_COUNT_V1;
}
