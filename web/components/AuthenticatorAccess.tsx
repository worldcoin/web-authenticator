import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { abortable } from "../lib/async";
import { hasSavedWallet, type WalletOpenMode } from "../lib/wallet-session";
import { walletOpenErrorMessage } from "../lib/wallet-errors";
import type { CredentialMetadata, WalletKit } from "../lib/walletkit";
import { Icon } from "../design/Icon";
import { AccessOptions } from "./AccessOptions";
import { CredentialsPanel } from "./CredentialsPanel";

const SelfieCheck = lazy(() => import("./SelfieCheck"));

export function AuthenticatorAccess({ onOpen, onSignedIn }: {
  onOpen: (signal: AbortSignal, progress: (message: string) => void, mode?: WalletOpenMode) => Promise<WalletKit>;
  onSignedIn: () => void;
}) {
  const [saved, setSaved] = useState(hasSavedWallet);
  const [records, setRecords] = useState<CredentialMetadata[] | null>(null);
  const [preview, setPreview] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const wallet = useRef<WalletKit | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const stop = () => { operation.current?.abort(); wallet.current?.terminate(); wallet.current = null; };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", restore);
    return () => { stop(); window.removeEventListener("pagehide", stop); window.removeEventListener("pageshow", restore); };
  }, []);
  const lock = () => { wallet.current?.terminate(); wallet.current = null; setRecords(null); setSaved(hasSavedWallet()); };
  const startAccess = async (mode: "open" | "create") => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setError(undefined);
    setProgress(mode === "create" ? "Create your passkey to continue." : "Use your passkey to sign in.");
    try {
      const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(310_000)]);
      const current = await abortable(onOpen(deadline, () => { if (!deadline.aborted && operation.current === controller) setProgress("Opening your authenticator…"); }, mode).then(value => {
        if (deadline.aborted) { value.terminate(); deadline.throwIfAborted(); }
        wallet.current = value; return value;
      }), deadline);
      setProgress("Loading your credentials…");
      const credentials = await abortable(current.listCredentials(), AbortSignal.any([deadline, AbortSignal.timeout(10_000)]));
      deadline.throwIfAborted(); setRecords(credentials); onSignedIn();
    } catch (cause) {
      wallet.current?.terminate(); wallet.current = null;
      if (!controller.signal.aborted) setError(walletOpenErrorMessage(cause));
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) { setProgress(null); setSaved(hasSavedWallet()); }
    }
  };
  if (preview) return <Suspense fallback={<p role="status">Opening Proof of Presence preview…</p>}>
    <SelfieCheck onClose={() => setPreview(false)} backLabel="Back to authenticator" />
  </Suspense>;

  return <div className="mx-auto my-6 w-[calc(100%-28px)] max-w-[470px] text-foreground-primary sm:my-10">
    <article className={`relative flex min-h-[606px] flex-col overflow-hidden rounded border border-stroke-secondary border-t-3 bg-background-primary p-6 ${records ? "border-t-accent-blue" : "border-t-stroke-primary"}`}>
      <div className="flex items-center justify-between border-b border-stroke-secondary pb-4 text-l3">
        <span className="flex items-center gap-2"><Icon icon="human-emblem" variant="solid" className="size-5 text-accent-blue" />World ID</span>
        <span className={records ? "rounded bg-status-success-background px-2 py-1 text-status-success" : "text-foreground-secondary"}>{records ? "●  Signed in" : "Signed out"}</span>
      </div>
      {records
        ? <CredentialsPanel records={records} onPreview={() => setPreview(true)} onLock={lock} />
        : <AccessOptions saved={saved} progress={progress} onOpen={startAccess} />}
      {error && <p className="mt-4 rounded-lg bg-status-error-background p-3 text-b2 text-status-error" role="alert">{error}</p>}
    </article>
  </div>;
}
