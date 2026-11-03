import { createRootRoute, createRoute, createRouter, RouterProvider, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "./AppShell";
import { AuthenticatorAccess } from "./components/AuthenticatorAccess";
import { consentClient, type ConsentClient } from "./lib/consent";
import { defaultServices, VerifyPage, type Services } from "./VerifyPage";

// Only /verify reads the request in the URL. It loads the request from the raw URL and removes
// the bridge key `k` itself, so the router must not interpret the query: the default JSON codec
// would re-encode values and rewrite the address bar before the page sees it. The query stays an
// opaque string.
const parseSearch = (search: string) => (search.length > 1 ? { query: search.slice(1) } : {});
const stringifySearch = (search: Record<string, unknown>) => (typeof search.query === "string" ? `?${search.query}` : "");

// A new page needs only a route here: the servers serve index.html for every non-file path.
function createAppRouter({ services, consent }: { services: Services; consent: ConsentClient }) {
  const root = createRootRoute({ component: () => <AppShell consent={consent} /> });
  // Both paths share this layout so navigation keeps the unlocked wallet mounted.
  const authenticator = createRoute({ getParentRoute: () => root, id: "authenticator-layout", component: function AuthenticatorRoute() {
    const navigate = useNavigate();
    return <AuthenticatorAccess onOpen={services.open} onSignedIn={() => void navigate({ to: "/authenticator", replace: true })} />;
  } });
  const routeTree = root.addChildren([
    authenticator.addChildren([
      createRoute({ getParentRoute: () => authenticator, path: "/" }),
      createRoute({ getParentRoute: () => authenticator, path: "/authenticator" }),
    ]),
    createRoute({ getParentRoute: () => root, path: "/verify", component: () => <VerifyPage services={services} /> }),
  ]);
  return createRouter({ routeTree, parseSearch, stringifySearch });
}

declare module "@tanstack/react-router" {
  interface Register { router: ReturnType<typeof createAppRouter> }
}

export function AuthenticatorAppV1({ services = defaultServices, consent = consentClient }: { services?: Services; consent?: ConsentClient }) {
  const [router] = useState(() => createAppRouter({ services, consent }));
  return <RouterProvider router={router} />;
}
