import type { Handler } from "../lib/http";
import { webBundleAvailable } from "../lib/static";

// Liveness: the process accepts requests. Never checks dependencies, so a
// dependency outage cannot trigger restarts.
export function live(): Response {
  return Response.json({ status: "ok" });
}

// Readiness: this instance can serve the app. The staging RP registry is
// deliberately excluded: when it is down only /api/staging-rp degrades (502),
// and probing a shared public RPC would pull every instance at once.
export function ready(staticRoot: string): Handler {
  return async () => (await webBundleAvailable(staticRoot))
    ? Response.json({ status: "ready" })
    : Response.json({ status: "unavailable", failed: ["web_bundle"] }, { status: 503 });
}
