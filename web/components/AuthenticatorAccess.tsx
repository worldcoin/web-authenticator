import { useEffect, useRef, useState, type ReactNode } from "react";
import { abortable } from "../lib/async";
import { hasSavedWallet } from "../lib/wallet-session";
import type { CredentialMetadata, WalletKit } from "../lib/walletkit";

/** Explicit access to an existing saved authenticator. No camera or account creation. */
export function AuthenticatorAccess({ devToggle, onOpen, onBack }: {
  devToggle: ReactNode;
  onOpen: (signal: AbortSignal, progress: (message: string) => void) => Promise<WalletKit>;
  onBack: () => void;
}) {
  const [saved] = useState(hasSavedWallet);
  const [records, setRecords] = useState<CredentialMetadata[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const wallet = useRef<WalletKit | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const stop = () => { operation.current?.abort(); wallet.current?.terminate(); wallet.current = null; };
    window.addEventListener("pagehide", stop);
    return () => { stop(); window.removeEventListener("pagehide", stop); };
  }, []);
  const lock = () => { wallet.current?.terminate(); wallet.current = null; setRecords(null); };
  const open = async () => {
    if (!saved || !hasSavedWallet() || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(undefined);
    try {
      const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(310_000)]);
      const current = await abortable(onOpen(deadline, () => {}).then(value => {
        if (deadline.aborted) { value.terminate(); deadline.throwIfAborted(); }
        wallet.current = value; return value;
      }), deadline);
      const credentials = await abortable(current.listCredentials(), AbortSignal.any([deadline, AbortSignal.timeout(10_000)]));
      deadline.throwIfAborted(); setRecords(credentials);
    } catch {
      wallet.current?.terminate(); wallet.current = null;
      if (!controller.signal.aborted) setError("Your authenticator couldn’t be opened. Try again with your saved passkey.");
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <div className="public-request-flow">
    <header className="dev-mode-bar"><p className="brand-label">World ID</p>{devToggle}</header>
    <div className="screen-content"><div className="centered-layout">
      <img className="request-passkey-emblem" src="/assets/figma/request-passkey-emblem.svg" alt="" />
      <div className="message-block"><h1>Your authenticator</h1>
        {!saved ? <p>Complete a Selfie Check from an app request, then save access with a passkey to return here.</p>
          : records ? <><p>{records.length} credential{records.length === 1 ? "" : "s"} in your saved authenticator.</p><ul className="access-credentials">{records.map(record => <li key={record.credentialId.toString()}>{record.issuerSchemaId === 11n ? "Selfie Check" : record.issuerSchemaId === 1n ? "Orb" : record.issuerSchemaId === 128n ? "Faux" : "Credential"}<span>{record.isExpired ? "Expired" : "Active"}</span></li>)}</ul></>
          : <p>Sign in with your saved passkey to view this browser’s authenticator.</p>}
        {error && <p className="error-copy" role="alert">{error}</p>}
      </div>
    </div></div>
    <div className="actions">
      {saved && (records ? <button className="primary-action" onClick={lock}>Lock authenticator</button> : <button className="primary-action" disabled={busy} onClick={() => void open()}>{busy ? "Opening authenticator…" : "Sign in with passkey"}</button>)}
      <button className="secondary-action" onClick={onBack}>Back to home</button>
    </div>
  </div>;
}
