export function RequestCompletion({ state, returnUrl, detail, onRetry, transient = false, saved = false }: {
  state: "complete" | "cancelled" | "expired" | "error";
  returnUrl?: string;
  detail?: string;
  onRetry?: () => void;
  transient?: boolean;
  saved?: boolean;
}) {
  const title = state === "complete" ? saved ? "Authenticator saved" : "Selfie captured"
    : state === "cancelled" ? "Check cancelled"
    : state === "expired" ? "This request has expired"
    : "Something went wrong";
  const description = state === "complete"
    ? transient ? "Your capture is complete." : "You can close this page."
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
    {!transient && <div className="actions">
      {onRetry && <button className="primary-action" onClick={onRetry}>Try again</button>}
      {returnUrl && <a className={onRetry ? "secondary-action return-link" : "primary-action return-link"} href={returnUrl}>Return to the app</a>}
    </div>}
  </>;
}
