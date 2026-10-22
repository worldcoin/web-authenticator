import { createRoot } from "react-dom/client";
import { HeadTurnChallengePreview } from "./components/HeadTurnChallengePreview";
import "./app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Challenge preview root is missing.");
createRoot(root).render(<HeadTurnChallengePreview />);
