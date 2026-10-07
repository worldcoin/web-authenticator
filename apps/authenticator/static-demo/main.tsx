import { createRoot } from "react-dom/client";
import type { AbortableSimulatorBrowserSessionPortV0 } from "../src/adapters/http-session";
import { AuthenticatorAppV1, makeAuthenticatorControllerFactoryV1 } from "../src/App";
import { createAuthenticatorServerRuntimeV0 } from "../src/server/runtime.server";
import "../src/styles/app.css";

// Static demo entry. The whole staging simulator (session gateway, demo
// authenticator, biometric and issuance simulators) runs inside this page, so
// `bun run build:static-demo` produces a plain static site with no server to
// host. This is a demo convenience only: keys are generated per page load and
// nothing here is a production trust boundary. The served app (`src/main.tsx`)
// keeps the simulator behind the same-origin Bun server.

const rootElement = document.getElementById("root");
if (rootElement === null) throw new TypeError("authenticator_root_missing");

const runtime = await createAuthenticatorServerRuntimeV0();
const sessionPort: AbortableSimulatorBrowserSessionPortV0 = runtime.browserPort;

createRoot(rootElement).render(
  <AuthenticatorAppV1 controllerFactory={makeAuthenticatorControllerFactoryV1(sessionPort)} />,
);
