import { authorizePoseGuard, PoseGuardRuns } from "../../../lib/poseguard";
import { createPoseGuardContext } from "../../../lib/poseguard-http";
import { challenge } from "./challenge";
import { verify } from "./verify";
import { cancel } from "./cancel";

export function createPoseGuardHandlers(runs = new PoseGuardRuns(), authorize = authorizePoseGuard) {
  const context = createPoseGuardContext(runs, authorize);
  return { challenge: challenge(context), verify: verify(context), cancel: cancel(context) };
}
