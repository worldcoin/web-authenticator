import { createRoot } from "react-dom/client";
import { AuthenticatorAppV1 } from "./App";
import "./styles/app.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new TypeError("authenticator_root_missing");

createRoot(rootElement).render(<AuthenticatorAppV1 />);
