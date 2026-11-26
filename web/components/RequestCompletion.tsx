import { Button } from "../design/Button";
import { buttonStyle } from "../design/buttons";
import { actions, centeredLayout, completionTitle, copy, detailCopy, messageBlock, screenContent } from "./styles";

export function RequestCompletion({ state, returnUrl, detail, onRetry, onOpen, onReturn, transient = false, saved = false }: {
  state: "complete" | "cancelled" | "expired" | "replayed" | "error";
  returnUrl?: string;
  detail?: string;
  onRetry?: () => void;
  onOpen?: () => void;
  onReturn?: () => void;
  transient?: boolean;
  saved?: boolean;
}) {
  const title = state === "complete" ? saved ? "Authenticator saved" : "Selfie captured"
    : state === "cancelled" ? "Check cancelled"
    : state === "expired" ? "This request has expired"
    : state === "replayed" ? "Proof already created"
    : "Something went wrong";
  const description = state === "complete"
    ? transient ? "Your capture is complete." : "You can close this page."
    : state === "cancelled" ? "You can close this tab and return to the app."
    : state === "expired" ? "Return to the app to start a new check."
    : state === "replayed" ? "The authenticator detected a nullifier replay for this action."
    : "The check could not be completed. Please try again.";

  const showAuthenticator = state === "complete" && saved && onOpen;

  return <>
    <div className={`${screenContent} group-data-[stage=confirmation-exit]/sequence:motion-safe:animate-completion-out`} data-testid="request-completion" role="status">
      <div className={`${centeredLayout} gap-6`}>
        <img className={state === "complete" ? "size-22" : "h-14 w-[56.0035px]"} src={state === "complete" ? "/assets/figma/request-completion-emblem.svg" : "/assets/figma/request-selfie-emblem.svg"} alt="" />
        <div className={`${messageBlock} gap-3`}><h1 className={completionTitle}>{title}</h1><p className={`${copy} text-foreground-secondary`}>{description}</p>{detail && <p className={`${detailCopy} text-foreground-secondary`}>{detail}</p>}</div>
      </div>
    </div>
    {!transient && <div className={actions}>
      {showAuthenticator && <Button buttonStyle="primary48" className="w-full max-w-[345px]" onClick={onOpen}>Go to authenticator</Button>}
      {onRetry && <Button buttonStyle="primary48" className="w-full" onClick={onRetry}>Try again</Button>}
      {onReturn ? <Button buttonStyle={onRetry ? "tertiary48" : "primary48"} className="w-full" onClick={onReturn}>Return to demo</Button>
        : returnUrl && <a className={`${buttonStyle(onRetry || showAuthenticator ? "tertiary48" : "primary48")} w-full`} href={returnUrl}>Return to the app</a>}
    </div>}
  </>;
}
