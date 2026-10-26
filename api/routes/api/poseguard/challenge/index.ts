import type { PoseGuardContext } from "../../../../lib/poseguard-http";

export function challenge({ runs, authorize, reply, handle }: PoseGuardContext) {
  return handle(131_072, async body => {
    let authorization;
    try { authorization = await authorize(body); }
    catch { return reply({ error: "invalid_request" }, 403); }
    return reply(runs.create(authorization.binding, authorization.expiresAt), 201);
  });
}
