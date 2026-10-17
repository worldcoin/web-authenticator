// Connector links point at /verify; the SPA reads the query from the root.
export function GET(request: Request): Response {
  return new Response(null, { status: 302, headers: { Location: `/${new URL(request.url).search}` } });
}
