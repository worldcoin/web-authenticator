import { actions, body, centeredLayout, errorCopy, messageBlock, primaryAction, screenContent, secondaryAction, screenTitle } from "./styles";

export function SaveAccessDecision({ busy, error, onSave, onSkip }: {
  busy: boolean;
  error?: string | null;
  onSave: () => void;
  onSkip: () => void;
}) {
  return <>
    <div className={screenContent}>
      <div className={`${centeredLayout} gap-8`}>
        <img className="size-14" src="/assets/figma/request-passkey-emblem.svg" alt="" />
        <div className={`${messageBlock} gap-4`}>
          <h1 className={screenTitle}>Save your authenticator?</h1>
          <p className={body}>Use a passkey to save access to this authenticator in this browser.</p>
          {error && <p className={errorCopy} role="alert">{error}</p>}
        </div>
      </div>
    </div>
    <div className={actions}>
      <button className={primaryAction} disabled={busy} onClick={onSave}><span aria-live="polite">{busy ? "Saving authenticator…" : "Save with passkey"}</span></button>
      <button className={secondaryAction} disabled={busy} onClick={onSkip}>Not now</button>
    </div>
  </>;
}
