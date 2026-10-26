import { isPoseGuardCapability } from "../../../../../packages/contracts/src/poseguard";
import type { PoseGuardContext } from "../../../../lib/poseguard-http";

export function cancel({ runs, reply, handle }: PoseGuardContext) {
  return handle(1024, body => {
    if (!isPoseGuardCapability(body) || Object.keys(body).sort().join(",") !== "capability,id") return reply({ error: "invalid_request" }, 400);
    runs.cancel(body.id, body.capability);
    return new Response(null, { status: 204 });
  });
}
