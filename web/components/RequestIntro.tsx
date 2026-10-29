import { actions, body, centeredLayout, copy, detailCopy, messageBlock, primaryAction, returnLink, screenContent, secondaryAction, screenTitle } from "./styles";

export type RequestIntroState = "verifying" | "ready" | "expired" | "invalid" | "unsupported";

/**
 * First screen for a request link (/verify), in the same layout as the review
 * screens that follow it. The requesting RP is shown only once the request has
 * been fetched, its signature checked against the registry and its expiry
 * confirmed. Expired, invalid and unsupported requests end here: there is no
 * way forward, only back to the requesting app.
 */
export function RequestIntro({ state, rp, reason, detail, returnUrl, busy, onStart, onCancel, selfieOnly = false }: {
  state: RequestIntroState;
  rp?: string;
  reason?: string;
  detail?: string | null;
  returnUrl?: string;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  selfieOnly?: boolean;
}) {
  const open = state === "verifying" || state === "ready";
  const title = state === "expired" ? "This request has expired"
    : state === "unsupported" ? "This request isn’t supported here"
    : state === "invalid" ? "This request can’t be verified"
    : null;

  return <>
    <div className={screenContent}><div className={`${centeredLayout} gap-8`}>
      <img className={selfieOnly ? "h-14 w-[56.0035px]" : "size-18"} src={selfieOnly ? "/assets/figma/request-selfie-emblem.svg" : "/assets/brand/human-badge.svg"} alt="" />
      <div className={`${messageBlock} gap-4`}>
        {open && selfieOnly ? <>
          <h1 className={screenTitle}>Complete a Selfie Check</h1>
          <p className={body}>{state === "ready" ? `${rp} is requesting a Selfie Check.` : "Checking the app’s request…"}</p>
          <p className={`${copy} text-[15px] text-foreground-secondary`}>Use your camera to capture a selfie. This preview does not submit a verification.</p>
        </> : open ? <h1 className={screenTitle}>
          {state === "ready"
            ? rp
            : <span className="inline-block h-[0.9em] w-[3.5em] animate-request-shimmer rounded-md bg-[linear-gradient(90deg,#ecebe8_0%,#f6f5f3_50%,#ecebe8_100%)] bg-size-[200%_100%] bg-position-[0_0] align-[-0.05em]"><span className="sr-only">An app</span></span>}
          {" "}is requesting your World ID Presence Credential
        </h1> : <>
          <h1 className={screenTitle}>{title}</h1>
          <p className={body}>{state === "unsupported" && reason ? reason : "Close this tab and return to the app to start again."}</p>
          {detail && <p className={`${detailCopy} text-[#4e4e4e]`}>{detail}</p>}
        </>}
      </div>
    </div></div>
    <div className={actions}>
      {open && <>
        <button className={primaryAction} disabled={state !== "ready" || busy} onClick={onStart}>
          <span aria-live="polite">{state === "ready" ? selfieOnly ? "Start selfie check" : "Start check" : "Verifying request…"}</span>
        </button>
        {state === "ready" && <button className={secondaryAction} disabled={busy} onClick={onCancel}>Cancel request</button>}
      </>}
      {!open && returnUrl && <a className={`${primaryAction} ${returnLink}`} href={returnUrl}>Return to the app</a>}
    </div>
  </>;
}
