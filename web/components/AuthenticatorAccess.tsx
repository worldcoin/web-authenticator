import { useEffect, useRef, useState } from "react";
import { abortable } from "../lib/async";
import { hasSavedWallet } from "../lib/wallet-session";
import type { CredentialMetadata, WalletKit } from "../lib/walletkit";
import { actions, body, centeredLayout, errorCopy, messageBlock, primaryAction, requestFrame, screenContent, secondaryAction, screenTitle } from "./styles";

/** Explicit access to an existing saved authenticator. No camera or account creation. */
export function AuthenticatorAccess({ onOpen, onBack }: {
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
  return <div className={requestFrame}>
    <div className={screenContent}><div className={`${centeredLayout} gap-8`}>
      <img className="size-14" src="/assets/figma/request-passkey-emblem.svg" alt="" />
      <div className={`${messageBlock} gap-4`}><h1 className={screenTitle}>Your authenticator</h1>
        {!saved ? <p className={body}>Complete a Selfie Check from an app request, then save access with a passkey to return here.</p>
          : records ? <><p className={body}>{records.length} credential{records.length === 1 ? "" : "s"} in your saved authenticator.</p><ul className="mx-0 my-2 grid w-full gap-3 text-left">{records.map(record => <li className="flex justify-between gap-4 rounded-xl border border-stroke-secondary p-3" key={record.credentialId.toString()}>{record.issuerSchemaId === 11n ? "Selfie Check" : record.issuerSchemaId === 1n ? "Orb" : record.issuerSchemaId === 128n ? "Faux" : "Credential"}<span className="text-foreground-secondary">{record.isExpired ? "Expired" : "Active"}</span></li>)}</ul></>
          : <p className={body}>Sign in with your saved passkey to view this browser’s authenticator.</p>}
        {error && <p className={errorCopy} role="alert">{error}</p>}
      </div>
    </div></div>
    <div className={actions}>
      {saved && (records ? <button className={primaryAction} onClick={lock}>Lock authenticator</button> : <button className={primaryAction} disabled={busy} onClick={() => void open()}>{busy ? "Opening authenticator…" : "Sign in with passkey"}</button>)}
      <button className={secondaryAction} onClick={onBack}>Back to home</button>
    </div>
  </div>;
}
