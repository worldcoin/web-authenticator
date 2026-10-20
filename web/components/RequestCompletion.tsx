export function RequestCompletion({ state, returnUrl, detail, onRetry, onContinue }: {
  state: "complete" | "cancelled" | "expired" | "error";
  returnUrl?: string;
  detail?: string;
  onRetry?: () => void;
  onContinue?: () => void;
}) {
  const title = state === "complete" ? "Selfie captured"
    : state === "cancelled" ? "Check cancelled"
    : state === "expired" ? "This request has expired"
    : "Something went wrong";
  const description = state === "complete"
    ? "Your selfie has been cleared. No verification was submitted. You can close this tab."
    : state === "cancelled" ? "You can close this tab and return to the app."
    : state === "expired" ? "Return to the app to start a new check."
    : "The check could not be completed. Please try again.";

  return <>
    <div className="screen-content request-completion" role="status">
      <div className="centered-layout">
        <img className={state === "complete" ? "request-completion-emblem" : "request-selfie-emblem"} src={state === "complete" ? "/assets/figma/request-completion-emblem.svg" : "/assets/figma/request-selfie-emblem.svg"} alt="" />
        <div className="message-block"><h1>{title}</h1><p>{description}</p>{detail && <p className="detail-copy">{detail}</p>}</div>
      </div>
    </div>
    <div className="actions">
      {onContinue && <button className="primary-action" onClick={onContinue}>Continue</button>}
      {onRetry && <button className="primary-action" onClick={onRetry}>Try again</button>}
      {returnUrl && <a className={onRetry || onContinue ? "secondary-action return-link" : "primary-action return-link"} href={returnUrl}>Return to the app</a>}
    </div>
  </>;
}
