import { poseDirection } from "../lib/poseguard/capture";
import type { PoseTarget } from "../lib/poseguard/types";

export function PoseTargetIndicator({ target }: { target: PoseTarget }) {
  const { degrees } = poseDirection(target);
  return <span aria-hidden="true" data-testid="pose-target-indicator"
    className="pointer-events-none absolute inset-0 rounded-[50%] border-8 border-accent"
    style={{ maskImage: `conic-gradient(from ${67.5 - degrees}deg, #000 0deg 45deg, transparent 45deg)` }} />;
}
