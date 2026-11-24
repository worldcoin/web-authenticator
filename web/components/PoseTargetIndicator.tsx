import { poseDirection } from "../lib/poseguard/capture";
import type { PoseTarget } from "../lib/poseguard/types";
import { RING_VIEW_BOX, ringPoint } from "./CaptureProgressRing";

const ARC_DEGREES = 48;
const ARC_POINTS = 16;
/** How far the chevron disc sits outside the dot ring, in ring units. */
export const CHEVRON_OUTSET = 30;

/** A bumper on the ring and a chevron outside it, both pointing where the user should turn. */
export function PoseTargetIndicator({ target, aligned }: { target: PoseTarget; aligned: boolean }) {
  // poseDirection measures counterclockwise from the right; the ring measures clockwise from the top.
  const angle = (90 - poseDirection(target).degrees + 360) % 360;
  const arc = Array.from({ length: ARC_POINTS + 1 }, (_, index) =>
    ringPoint(angle - ARC_DEGREES / 2 + index * ARC_DEGREES / ARC_POINTS));
  const [x, y] = ringPoint(angle, CHEVRON_OUTSET);
  return <svg className="pointer-events-none absolute top-0 left-0 h-auto w-[345.005px] max-w-full overflow-visible text-accent"
    data-testid="pose-target-indicator" data-angle={Math.round(angle)} data-aligned={aligned}
    viewBox={RING_VIEW_BOX} fill="none" aria-hidden="true">
    <path d={arc.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ")}
      stroke="currentColor" strokeOpacity={aligned ? 1 : 0.22} strokeWidth="14" strokeLinecap="round" />
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(1)})`}>
      <circle r="17" fill="currentColor" />
      <path d="M-6 3 0-4l6 7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>;
}
