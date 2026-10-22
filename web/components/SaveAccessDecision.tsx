export function SaveAccessDecision({ busy, error, onSave, onSkip }: {
  busy: boolean;
  error?: string | null;
  onSave: () => void;
  onSkip: () => void;
}) {
  return <>
    <div className="screen-content">
      <div className="centered-layout">
        <img className="request-passkey-emblem" src="/assets/figma/request-passkey-emblem.svg" alt="" />
        <div className="message-block">
          <h1>Save your authenticator?</h1>
          <p>Use a passkey to save access to this authenticator in this browser.</p>
          {error && <p className="error-copy" role="alert">{error}</p>}
        </div>
      </div>
    </div>
    <div className="actions">
      <button className="primary-action" disabled={busy} onClick={onSave}><span aria-live="polite">{busy ? "Saving authenticator…" : "Save with passkey"}</span></button>
      <button className="secondary-action" disabled={busy} onClick={onSkip}>Not now</button>
    </div>
  </>;
}
