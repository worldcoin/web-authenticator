import { readJsonBody } from "../../../lib/request-body";
import { consentCookie, effectiveConsent, type ConsentChoice } from "../../../lib/consent";

export function GET(request: Request): Response {
  return Response.json({ analytics: effectiveConsent(request) });
}

// Only the page itself may record a choice: a cross-site request must not be
// able to grant analytics consent on the user's behalf.
export async function PUT(request: Request): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if ((site !== null && site !== "same-origin") || !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  let choice: unknown;
  try {
    choice = ((await readJsonBody(request, 1024)) as { analytics?: unknown }).analytics;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (choice !== "granted" && choice !== "denied") {
    return Response.json({ error: "analytics must be \"granted\" or \"denied\"" }, { status: 400 });
  }
  return Response.json({ analytics: choice }, { headers: { "Set-Cookie": consentCookie(choice as ConsentChoice) } });
}
