// The web app is a single page: its router (web/App.tsx) owns every path that is not an API
// call or a file, so the server answers all of them with index.html. A last segment with a
// dot is a file request (assets, .wasm), which must 404 when missing rather than return HTML.
export function isClientRoute(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/_cf/")) return false;
  return !(pathname.split("/").pop() ?? "").includes(".");
}
