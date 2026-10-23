import { createRoot } from "react-dom/client";
import { AuthenticatorAppV1 } from "./App";
import "./app.css";
import { PoseGuardDemo } from "./components/PoseGuardDemo";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new TypeError("authenticator_root_missing");

createRoot(rootElement).render(window.location.pathname === "/poseguard" ? <PoseGuardDemo /> : <AuthenticatorAppV1 />);
