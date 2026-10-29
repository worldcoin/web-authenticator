import type { Handler } from "../../lib/http";
import { serveIndex } from "../../lib/static";

// Saved-authenticator access outside a request. The app renders /recover itself.
export function page(staticRoot: string): Handler {
  return () => serveIndex(staticRoot);
}
