export type RequestIntroState = "verifying" | "ready" | "expired" | "invalid" | "unsupported";

/**
 * First screen for a request link (/verify), in the same layout as the review
 * screens that follow it. The requesting RP is shown only once the request has
 * been fetched, its signature checked against the registry and its expiry
 * confirmed. Expired, invalid and unsupported requests end here: there is no
 * way forward, only back to the requesting app.
 */
export function RequestIntro({ state, rp, reason, detail, returnUrl, busy, onStart, onCancel, selfieOnly = false, submitsSelfie = false }: {
  state: RequestIntroState;
  rp?: string;
  reason?: string;
  detail?: string | null;
  returnUrl?: string;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  selfieOnly?: boolean;
  submitsSelfie?: boolean;
}) {
  const open = state === "verifying" || state === "ready";
  const title = state === "expired" ? "This request has expired"
    : state === "unsupported" ? "This request isn’t supported here"
    : state === "invalid" ? "This request can’t be verified"
    : null;

  return <>
    <div className="screen-content"><div className="centered-layout">
      <img className={selfieOnly ? "request-selfie-emblem" : "hero-icon"} src={selfieOnly ? "/assets/figma/request-selfie-emblem.svg" : "/assets/brand/human-badge.svg"} alt="" />
      <div className="message-block">
        {open && selfieOnly ? <>
          <h1>Complete a Selfie Check</h1>
          <p>{state === "ready" ? `${rp} is requesting a Selfie Check.` : "Checking the app’s request…"}</p>
          <p className="request-preview-note">{submitsSelfie
            ? "Use your camera to capture a selfie. A verified secure enclave checks it. This preview does not issue a credential."
            : "Use your camera to capture a selfie. This preview does not submit a verification."}</p>
        </> : open ? <h1>
          {state === "ready"
            ? rp
            : <span className="request-skeleton"><span className="sr-only">An app</span></span>}
          {" "}is requesting your World ID Presence Credential
        </h1> : <>
          <h1>{title}</h1>
          <p>{state === "unsupported" && reason ? reason : "Close this tab and return to the app to start again."}</p>
          {detail && <p className="detail-copy">{detail}</p>}
        </>}
      </div>
    </div></div>
    <div className="actions">
      {open && <>
        <button className="primary-action" disabled={state !== "ready" || busy} onClick={onStart}>
          <span aria-live="polite">{state === "ready" ? selfieOnly ? "Start selfie check" : "Start check" : "Verifying request…"}</span>
        </button>
        {state === "ready" && <button className="secondary-action" disabled={busy} onClick={onCancel}>Cancel request</button>}
      </>}
      {!open && returnUrl && <a className="primary-action return-link" href={returnUrl}>Return to the app</a>}
    </div>
  </>;
}
