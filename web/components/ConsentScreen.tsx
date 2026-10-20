import type { ReactNode } from "react";
import type { ConsentChoice } from "../lib/consent";
import { SigninPage } from "./SigninPage";

/**
 * First-visit analytics choice, shown before any page content until the server
 * holds a decision. Copy is a placeholder pending legal review.
 */
export function ConsentScreen({ busy, error, footerActions, onChoose }: {
  busy: boolean;
  error: string | null;
  footerActions: ReactNode;
  onChoose: (choice: ConsentChoice) => void;
}) {
  return <SigninPage footerActions={footerActions}>
    <section className="consent-screen" aria-labelledby="consent-title">
      <h1 id="consent-title">Help improve World ID</h1>
      <p className="consent-copy">Share anonymous usage data, such as which steps succeed or fail. Never photos, face data, or account identifiers.</p>
      <div className="consent-actions">
        <button className="signin-primary" disabled={busy} onClick={() => onChoose("granted")}>Accept</button>
        <button className="signin-secondary" disabled={busy} onClick={() => onChoose("denied")}>Decline</button>
      </div>
      {error && <p className="signin-error" role="alert">{error}</p>}
      <p className="consent-note">Change this anytime from Cookie settings.</p>
    </section>
  </SigninPage>;
}
