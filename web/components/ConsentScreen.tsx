import type { ConsentChoice } from "../lib/consent";
import { SigninPage } from "./SigninPage";
import { signinError, signinHeading, signinPrimary, signinSecondary } from "./styles";

/**
 * First-visit analytics choice, shown before any page content until this browser
 * holds a decision. Copy is a placeholder pending legal review.
 */
export function ConsentScreen({ busy, error, onChoose }: {
  busy: boolean;
  error: string | null;
  onChoose: (choice: ConsentChoice) => void;
}) {
  return <SigninPage>
    <section className="flex w-full flex-col items-center" aria-labelledby="consent-title">
      <h1 id="consent-title" className={`${signinHeading} text-[32px] leading-[1.15] tracking-[-0.02em] md:text-[40px]`}>Help improve World ID</h1>
      <p className="mt-4 max-w-100 text-[16px] leading-[1.5] text-ink-muted">Share anonymous usage data, such as which steps succeed or fail. Never photos, face data, or account identifiers.</p>
      <div className="mt-8 grid w-full max-w-90 gap-3">
        <button className={signinPrimary} disabled={busy} onClick={() => onChoose("granted")}>Accept</button>
        <button className={signinSecondary} disabled={busy} onClick={() => onChoose("denied")}>Decline</button>
      </div>
      {error && <p className={`${signinError} max-w-90`} role="alert">{error}</p>}
      <p className="mt-5 text-[13px] text-ink-muted">Change this anytime from Cookie settings.</p>
    </section>
  </SigninPage>;
}
