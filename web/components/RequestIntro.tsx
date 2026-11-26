import { actions, body, centeredLayout, messageBlock, primaryAction, returnLink, screenContent, secondaryAction, screenTitle } from "./styles";

export type RequestIntroState = "verifying" | "ready" | "expired" | "invalid" | "unsupported";

const DISCLOSURES = [
  { label: "Proof of selfie", icon: "/assets/figma/human-emblem.svg", shared: true },
  { label: "Your selfie", icon: "/assets/figma/person-circle.svg", shared: false },
  { label: "Your passkey", icon: "/assets/figma/person-key.svg", shared: false },
] as const;
const shimmer = "animate-request-shimmer bg-[linear-gradient(90deg,#ecebe8_0%,#f6f5f3_50%,#ecebe8_100%)] bg-size-[200%_100%] bg-position-[0_0]";

/**
 * First screen for a request link (/verify): what the requesting app receives from the Selfie Check.
 * The requesting RP is shown only once the request has been fetched, its signature checked against
 * the registry and its expiry confirmed. Expired, invalid and unsupported requests end here: there
 * is no way forward, only back to the requesting app.
 */
export function RequestIntro({ state, rp, reason, returnUrl, onStart, onCancel }: {
  state: RequestIntroState;
  rp?: string;
  reason?: string;
  returnUrl?: string;
  onStart: () => void;
  onCancel: () => void;
}) {
  if (state === "verifying" || state === "ready") {
    return <RequestConsent rp={state === "ready" ? rp : undefined} onStart={onStart} onCancel={onCancel} />;
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
      {returnUrl && <a className={`${primaryAction} ${returnLink}`} href={returnUrl}>Return to the app</a>}
    </div>
  </>;
}

/** Without an `rp` the request is still being verified, so the app stays anonymous and the check cannot start. */
function RequestConsent({ rp, onStart, onCancel }: { rp?: string; onStart: () => void; onCancel: () => void }) {
  const ready = rp !== undefined;
  return <>
    <div className={screenContent}><div className="flex w-full flex-col">
      <div className={`${centeredLayout} mx-auto gap-6`}>
        {ready
          ? <span aria-hidden="true" className="grid size-18 place-items-center rounded-[20px] bg-brand-blue text-[32px] font-medium text-white">{rp.charAt(0).toUpperCase()}</span>
          : <span aria-hidden="true" className={`size-18 rounded-[20px] ${shimmer}`} />}
        <div className={`${messageBlock} gap-4`}>
          <h1 className={screenTitle}>
            Request from {ready ? rp : <span className={`inline-block h-[0.9em] w-[3.5em] rounded-md align-[-0.05em] ${shimmer}`}><span className="sr-only">an app</span></span>}
          </h1>
          <p className={body}>Confirm you’re a real person with selfie check without sharing identity</p>
        </div>
      </div>
      <hr className="-mx-6 my-11 border-0 border-t border-stroke-secondary min-[600px]:-mx-10" />
      <section className="flex flex-col gap-6 px-2 text-left" aria-labelledby="request-disclosures">
        <h2 id="request-disclosures" className="text-[17px] leading-[22px] font-normal text-foreground">App will receive</h2>
        <ul className="flex flex-col gap-6">
          {DISCLOSURES.map(({ label, icon, shared }) => <li key={label} className={`flex items-center gap-4 text-[17px] leading-[22px] ${shared ? "text-foreground" : "text-foreground-secondary"}`}>
            <img className="size-[22px]" src={icon} alt="" />
            <span className="flex-1">{label}</span>
            <img className="size-[22px]" src={shared ? "/assets/figma/disclosure-check.svg" : "/assets/figma/disclosure-x.svg"} alt={shared ? "Shared" : "Not shared"} />
          </li>)}
        </ul>
      </section>
    </div></div>
    <div className={actions}>
      <button className={primaryAction} disabled={!ready} onClick={onStart}>
        <span aria-live="polite">{ready ? "Continue" : "Verifying request…"}</span>
      </button>
      {ready && <button className={secondaryAction} onClick={onCancel}>Cancel request</button>}
    </div>
  </>;
}
