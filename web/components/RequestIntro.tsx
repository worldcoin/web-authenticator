import { Button } from "../design/Button";
import { buttonStyle } from "../design/buttons";
import { RequestConsent } from "./RequestConsent";
import { actions, body, centeredLayout, messageBlock, screenContent, screenTitle } from "./styles";

export type RequestIntroState = "verifying" | "ready" | "expired" | "invalid" | "unsupported";

/**
 * First screen for a request link (/verify): what the requesting app receives from the Proof of Presence.
 * The requesting RP is shown only once the request has been fetched, its signature checked against
 * the registry and its expiry confirmed. Expired, invalid and unsupported requests end here: there
 * is no way forward, only back to the requesting app.
 */
export function RequestIntro({ state, rp, reason, returnUrl, pending, error, onStart, onCancel, onReturn }: {
  state: RequestIntroState;
  rp?: string;
  reason?: string;
  returnUrl?: string;
  /** Progress while the passkey opens: Continue shows as pending. */
  pending?: string;
  error?: string;
  onStart: () => void;
  onCancel: () => void;
  onReturn?: () => void;
}) {
  if (state === "verifying" || state === "ready") {
    return <RequestConsent rp={state === "ready" ? rp : undefined} pending={pending} error={error} onStart={onStart} onCancel={onCancel} />;
  }
  const title = state === "expired" ? "This request has expired"
    : state === "unsupported" ? "This request isn’t supported here"
    : "This request can’t be verified";

  return <>
    <div className={screenContent}><div className={`${centeredLayout} gap-8`}>
      <img className="h-14 w-[56.0035px]" src="/assets/figma/request-selfie-emblem.svg" alt="" />
      <div className={`${messageBlock} gap-4`}>
        <h1 className={screenTitle}>{title}</h1>
        <p className={body}>{state === "unsupported" && reason ? reason : "Close this tab and return to the app to start again."}</p>
      </div>
    </div></div>
    <div className={actions}>
      {onReturn ? <Button buttonStyle="primary48" className="w-full" onClick={onReturn}>Return to demo</Button>
        : returnUrl && <a className={`${buttonStyle("primary48")} w-full`} href={returnUrl}>Return to the app</a>}
    </div>
  </>;
}
