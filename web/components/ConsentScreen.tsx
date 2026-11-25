import { Button } from "../design/Button";
import { Icon } from "../design/Icon";
import type { ConsentChoice } from "../lib/consent";

/**
 * First-visit analytics choice, shown before any page content until this browser
 * holds a decision. Copy is a placeholder pending legal review.
 */
export function ConsentScreen({ busy, error, onChoose }: {
  busy: boolean;
  error: string | null;
  onChoose: (choice: ConsentChoice) => void;
}) {
  return <div className="flex w-full flex-1 flex-col text-foreground-primary">
    <section className="flex flex-1 items-center justify-center px-6 py-16 md:py-18">
      <div className="flex w-full max-w-130 flex-col items-center text-center">
        <Icon icon="human-emblem" variant="solid" className="mb-5 size-18 text-accent-blue" />
        <section className="flex w-full flex-col items-center" aria-labelledby="consent-title">
          <h1 id="consent-title" className="text-h1 text-foreground-primary focus:outline-none">Help improve World ID</h1>
          <p className="mt-4 max-w-100 text-b1 text-foreground-secondary">Share anonymous usage data, such as which steps succeed or fail. Never photos, face data, or account identifiers.</p>
          <div className="mt-8 grid w-full max-w-90 gap-3">
            <Button buttonStyle="primary48" className="w-full" disabled={busy} onClick={() => onChoose("granted")}>Accept</Button>
            <Button buttonStyle="tertiary48" className="w-full" disabled={busy} onClick={() => onChoose("denied")}>Decline</Button>
          </div>
          {error && <p className="mt-4 max-w-90 rounded-2xl border border-status-error-stroke bg-status-error-background px-4 py-3 text-b2 text-status-error" role="alert">{error}</p>}
          <p className="mt-5 text-b3 text-foreground-secondary">Change this anytime from Cookie settings.</p>
        </section>
      </div>
    </section>
  </div>;
}
