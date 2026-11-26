import { useState } from "react";
import { RequesterMark } from "./RequesterMark";
import { Button } from "../design/Button";
import { Icon, type IconName } from "../design/Icon";
import { actions, body, centeredLayout, messageBlock, screenContent, screenTitle } from "./styles";

/*
 * REQUEST INTRO — from request verification
 *   0 ms  W drops into focus
 *  65 ms  Requester heading follows
 * 110 ms  Explanation settles
 * 150 ms  Divider widens
 * 185 ms  Disclosure heading enters
 * 220 ms  Rows descend in reading order, 30 ms apart
 * 355 ms  Continue fades in
 * 400 ms  Cancel request closes the sequence
 */
const TIMING = {
  mark: 0,
  heading: 65,
  explanation: 110,
  divider: 150,
  disclosures: 185,
  firstRow: 220,
  rowInterval: 30,
  continue: 355,
  cancel: 400,
};

const DISCLOSURES: readonly { label: string; icon: IconName; shared: boolean }[] = [
  { label: "Proof of Presence", icon: "presence-emblem", shared: true },
  { label: "Your selfie", icon: "person-circle", shared: false },
  { label: "Your passkey", icon: "person-key", shared: false },
];
const shimmer = "animate-request-shimmer bg-[linear-gradient(90deg,var(--color-background-tertiary)_0%,var(--color-background-secondary)_50%,var(--color-background-tertiary)_100%)] bg-size-[200%_100%] bg-position-[0_0]";

/**
 * The request intro while the request is verified and once it is ready: who is asking and what they receive,
 * like the iOS proof request sheet. Without an `rp` the request is still being verified, so the app stays
 * anonymous and the check cannot start.
 */
export function RequestConsent({ rp, pending, error, onStart, onCancel }: {
  rp?: string;
  /** Progress while the passkey opens: Continue shows as pending and announces it. */
  pending?: string;
  error?: string;
  onStart: () => void;
  onCancel: () => void;
}) {
  const ready = rp !== undefined;
  const [interacted, setInteracted] = useState(false);
  const entrance = interacted ? "settled" : ready ? "entering" : "verifying";
  return <>
    <div className={screenContent} data-intro-state={entrance}><div className="flex w-full flex-col">
      <div className={`${centeredLayout} mx-auto gap-6`}>
        <span aria-hidden="true" className={`size-18 rounded-[20px] ${ready ? "" : shimmer}`}>
          {ready && <span className="intro-beat intro-mark grid size-full place-items-center rounded-[inherit]" style={beat(TIMING.mark)}><RequesterMark /></span>}
        </span>
        <div className={`${messageBlock} gap-4`}>
          <h1 className={`${screenTitle} intro-beat intro-heading`} style={beat(TIMING.heading)}>
            Request from {ready ? rp : <span className={`inline-block h-[0.9em] w-[3.5em] rounded-md align-[-0.05em] ${shimmer}`}><span className="sr-only">an app</span></span>}
          </h1>
          <p className={`${body} intro-beat`} style={beat(TIMING.explanation)}>Confirm you’re a real person with Proof of Presence without sharing identity</p>
        </div>
      </div>
      <hr style={beat(TIMING.divider)} className="intro-beat intro-divider -mx-6 my-11 border-0 border-t border-stroke-secondary min-[600px]:-mx-10" />
      <section className="flex flex-col gap-6 px-2 text-left" aria-labelledby="request-disclosures">
        <h2 id="request-disclosures" style={beat(TIMING.disclosures)} className="intro-beat text-s1 text-foreground-primary">App will receive</h2>
        <ul className="flex flex-col gap-6">
          {DISCLOSURES.map(({ label, icon, shared }, index) => <li key={label}
            style={beat(TIMING.firstRow + index * TIMING.rowInterval)} className={`intro-beat intro-row flex items-center gap-4 text-b1 ${shared ? "text-foreground-primary" : "text-foreground-secondary"}`}>
            <Icon icon={icon} className={`size-[22px] ${shared ? "" : "text-foreground-tertiary"}`} />
            <span className="flex-1">{label}</span>
            {shared
              ? <Icon icon="check" label="Shared" className="size-[22px] text-accent-blue" />
              : <Icon icon="xmark" label="Not shared" className="size-[22px] text-foreground-tertiary" />}
          </li>)}
        </ul>
      </section>
    </div></div>
    <div className={`${actions} min-h-26`} data-intro-state={entrance}
      onFocusCapture={() => setInteracted(true)} onClickCapture={() => setInteracted(true)}>
      {error && <p className="rounded-xl bg-status-error-background px-4 py-3 text-b2 text-foreground-primary" role="alert">{error}</p>}
      {pending !== undefined && <p className="text-center text-b2 text-foreground-secondary" role="status">{pending}</p>}
      <div className="intro-beat intro-action flex" style={beat(TIMING.continue)}>
        <Button buttonStyle="primary48" className="request-continue w-full" disabled={!ready} loading={pending !== undefined} onClick={onStart}>
          <span aria-live="polite">{ready ? "Continue" : "Verifying request…"}</span>
        </Button>
      </div>
      {ready && <div className="intro-beat intro-action flex" style={beat(TIMING.cancel)}>
        <Button buttonStyle="tertiary48" className="w-full" onClick={onCancel}>Cancel request</Button>
      </div>}
    </div>
  </>;
}

function beat(delay: number) {
  return { animationDelay: `${delay}ms` };
}
