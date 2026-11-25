import { Button } from "../design/Button";
import { Icon, type IconName } from "../design/Icon";
import { actions, body, centeredLayout, messageBlock, screenContent, screenTitle } from "./styles";

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
export function RequestConsent({ rp, pending, onStart, onCancel }: {
  rp?: string;
  /** Progress while the passkey opens: Continue shows as pending and announces it. */
  pending?: string;
  onStart: () => void;
  onCancel: () => void;
}) {
  const ready = rp !== undefined;
  return <>
    <div className={screenContent}><div className="flex w-full flex-col">
      <div className={`${centeredLayout} mx-auto gap-6`}>
        {ready
          ? <span aria-hidden="true" className="grid size-18 place-items-center rounded-[20px] bg-accent-blue text-h1 text-foreground-inverse">{rp.charAt(0).toUpperCase()}</span>
          : <span aria-hidden="true" className={`size-18 rounded-[20px] ${shimmer}`} />}
        <div className={`${messageBlock} gap-4`}>
          <h1 className={screenTitle}>
            Request from {ready ? rp : <span className={`inline-block h-[0.9em] w-[3.5em] rounded-md align-[-0.05em] ${shimmer}`}><span className="sr-only">an app</span></span>}
          </h1>
          <p className={body}>Confirm you’re a real person with Proof of Presence without sharing identity</p>
        </div>
      </div>
      <hr className="-mx-6 my-11 border-0 border-t border-stroke-secondary min-[600px]:-mx-10" />
      <section className="flex flex-col gap-6 px-2 text-left" aria-labelledby="request-disclosures">
        <h2 id="request-disclosures" className="text-s1 text-foreground-primary">App will receive</h2>
        <ul className="flex flex-col gap-6">
          {DISCLOSURES.map(({ label, icon, shared }) => <li key={label} className={`flex items-center gap-4 text-b1 ${shared ? "text-foreground-primary" : "text-foreground-secondary"}`}>
            <Icon icon={icon} className={`size-[22px] ${shared ? "" : "text-foreground-tertiary"}`} />
            <span className="flex-1">{label}</span>
            {shared
              ? <Icon icon="check" label="Shared" className="size-[22px] text-accent-blue" />
              : <Icon icon="xmark" label="Not shared" className="size-[22px] text-foreground-tertiary" />}
          </li>)}
        </ul>
      </section>
    </div></div>
    <div className={actions}>
      <Button buttonStyle="primary48" className="w-full" disabled={!ready} loading={pending !== undefined} onClick={onStart}>
        <span aria-live="polite">{ready ? "Continue" : "Verifying request…"}</span>
      </Button>
      {pending !== undefined && <p className="sr-only" role="status">{pending}</p>}
      {ready && <Button buttonStyle="tertiary48" className="w-full" onClick={onCancel}>Cancel request</Button>}
    </div>
  </>;
}
