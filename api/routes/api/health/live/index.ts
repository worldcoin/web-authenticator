// Liveness: the process accepts requests. Never checks dependencies, so a
// dependency outage cannot trigger restarts.
export function GET(): Response {
  return Response.json({ status: "ok" });
}
