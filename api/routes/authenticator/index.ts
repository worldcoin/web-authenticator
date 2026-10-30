import type { Handler } from "../../lib/http";
import { serveIndex } from "../../lib/static";

// Saved-authenticator access. A client route of the web app, so the server serves the app.
export function page(staticRoot: string): Handler {
  return () => serveIndex(staticRoot);
}
