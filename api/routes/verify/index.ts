import type { Handler } from "../../lib/http";
import { serveIndex } from "../../lib/static";

// Request links (IDKit connector URLs) open the app here directly. No redirect,
// so the bridge key in the query reaches the server once rather than twice.
export function page(staticRoot: string): Handler {
  return () => serveIndex(staticRoot);
}
