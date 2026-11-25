import { poseDirection } from "../lib/poseguard/capture";
import type { PoseTarget } from "../lib/poseguard/types";
import { RING_VIEW_BOX, ringNormalDegrees, ringPoint } from "./CaptureProgressRing";

const BUMPER_DEGREES = 48;
// Each round cap reaches about 3° past the arc's ends.
const CAP_DEGREES = 3;
const ARC_POINTS = 16;
// The accent at 22 % over white, opaque so no dot can show through.
const BUMPER_TINT = "#c8e4fe";

/** A bumper on the ring with a chevron on it, pointing where the user should turn; solid once they are there. */
export function PoseTargetIndicator({ target, aligned }: { target: PoseTarget; aligned: boolean }) {
  const angle = targetDegrees(target);
  const arc = Array.from({ length: ARC_POINTS + 1 }, (_, index) =>
    ringPoint(angle - BUMPER_DEGREES / 2 + index * BUMPER_DEGREES / ARC_POINTS));
  const [x, y] = ringPoint(angle);
  return <svg className="pointer-events-none absolute top-0 left-0 h-auto w-[345.005px] max-w-full overflow-visible text-accent"
    data-testid="pose-target-indicator" data-angle={Math.round(angle)} data-aligned={aligned}
    viewBox={RING_VIEW_BOX} fill="none" aria-hidden="true">
    <path d={arc.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ")}
      stroke={aligned ? "currentColor" : BUMPER_TINT} strokeWidth="14" strokeLinecap="round" />
    <path transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ringNormalDegrees(angle).toFixed(1)})`} d="M-5.5 2.75 0-3.25l5.5 6"
      stroke={aligned ? "#fff" : "currentColor"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** The part of the ring the bumper covers, for the ring to leave its dots out. */
export function bumperGap(target: PoseTarget): { degrees: number; span: number } {
  return { degrees: targetDegrees(target), span: BUMPER_DEGREES + 2 * CAP_DEGREES };
}

/** Ring degrees, clockwise from the top; poseDirection measures counterclockwise from the right. */
export function targetDegrees(target: PoseTarget): number {
  return (90 - poseDirection(target).degrees + 360) % 360;
}
