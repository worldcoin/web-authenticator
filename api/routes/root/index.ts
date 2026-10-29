// "/" has no folder name of its own. The bare origin belongs to world.org; request
// links open /verify. Never forward the query: a stray connector link carries the
// bridge key. Temporary (302) so a redeploy can restore the route.
const WORLD_ORG_URL = "https://world.org/";

export function GET(): Response {
  return Response.redirect(WORLD_ORG_URL, 302);
}
