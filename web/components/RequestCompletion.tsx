import { actions, centeredLayout, completionTitle, copy, detailCopy, messageBlock, primaryAction, returnLink, screenContent, secondaryAction } from "./styles";

const MESSAGES = {
  cancelled: ["Check cancelled", "You can close this tab and return to the app."],
  expired: ["This request has expired", "Return to the app to start a new check."],
  replayed: ["Proof already created", "This authenticator has already proved this action for this app."],
  unavailable: ["This check can’t be completed here", "This authenticator has no credential for this request and can’t issue one."],
  error: ["Something went wrong", "The check could not be completed. Please try again."],
  "handed-off": ["Continued in another tab", "Your authenticator opened in another tab, so this tab stopped. You can close it."],
} as const;

/** How a request ended without a proof. */
export function RequestCompletion({ state, returnUrl, detail, onRetry }: {
  state: keyof typeof MESSAGES;
  returnUrl?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  const [title, description] = MESSAGES[state];
  return <>
    <div className={screenContent} data-testid="request-completion" role="status">
      <div className={`${centeredLayout} gap-6`}>
        <img className="h-14 w-[56.0035px]" src="/assets/figma/request-selfie-emblem.svg" alt="" />
        <div className={`${messageBlock} gap-3`}><h1 className={completionTitle}>{title}</h1><p className={`${copy} text-[17px] text-foreground-secondary`}>{description}</p>{detail && <p className={`${detailCopy} text-foreground-secondary`}>{detail}</p>}</div>
      </div>
    </div>
    <div className={actions}>
      {onRetry && <button className={primaryAction} onClick={onRetry}>Try again</button>}
      {returnUrl && <a className={`${onRetry ? secondaryAction : primaryAction} ${returnLink}`} href={returnUrl}>Return to the app</a>}
    </div>
  </>;
}
