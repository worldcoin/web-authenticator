import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { AuthenticatorApp, type AppProps } from "./AuthenticatorApp";

// The app reads its request from the raw URL and removes the bridge key `k` itself, so the
// router must not interpret the query: the default JSON codec would re-encode values and
// rewrite the address bar before the app sees it. Keep the query as an opaque string.
const parseSearch = (search: string) => (search.length > 1 ? { query: search.slice(1) } : {});
const stringifySearch = (search: Record<string, unknown>) => (typeof search.query === "string" ? `?${search.query}` : "");

// `/` is the landing page; `/verify` is where request links open. Both render the same app
// today, which tells them apart by the request in the URL. New pages get their own route here
// plus a server route in api/routes/index.ts and the Worker's asset lookup.
function createAppRouter(props: AppProps) {
  const root = createRootRoute();
  const component = () => <AuthenticatorApp {...props} />;
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/", component }),
    createRoute({ getParentRoute: () => root, path: "/verify", component }),
  ]);
  return createRouter({ routeTree, parseSearch, stringifySearch });
}

declare module "@tanstack/react-router" {
  interface Register { router: ReturnType<typeof createAppRouter> }
}

export function AuthenticatorAppV1(props: AppProps) {
  const [router] = useState(() => createAppRouter(props));
  return <RouterProvider router={router} />;
}
