import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { abortable } from "../lib/async";
import { hasSavedWallet, type WalletOpenMode } from "../lib/wallet-session";
import { walletOpenErrorMessage } from "../lib/wallet-errors";
import type { CredentialMetadata, WalletKit } from "../lib/walletkit";

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
  if (preview) return <Suspense fallback={<p role="status">Opening Selfie Check preview…</p>}>
    <SelfieCheck onClose={() => setPreview(false)} backLabel="Back to authenticator" />
  </Suspense>;

  return <div className="mx-auto my-6 w-[calc(100%-28px)] max-w-[470px] text-[#0d1421] sm:my-10">
    <article className={`relative flex min-h-[606px] flex-col overflow-hidden rounded border border-[#d6dde7] border-t-[3px] bg-[#fcfdfe] p-6 shadow-[0_18px_40px_-28px_rgba(13,20,33,.34)] ${records ? "border-t-[#0a5cfe]" : "border-t-[#0d1421]"}`}>
      <span aria-hidden="true" className="absolute top-2 right-2 text-[#c3cddb]">+</span>
      <span aria-hidden="true" className="absolute bottom-2 left-2 text-[#c3cddb]">+</span>
      <div className="flex items-center justify-between border-b border-[#d6dde7] pb-4 text-[13px] font-medium">
        <span className="flex items-center gap-2"><img className="size-5" src="/assets/brand/human-badge.svg" alt="" />World ID</span>
        <span className={records ? "rounded bg-[#e6f5ee] px-2 py-1 text-[#0a5c40]" : "text-[#657184]"}>{records ? "●  Signed in" : "Signed out"}</span>
      </div>
      {records
        ? <CredentialsPanel records={records} onPreview={() => setPreview(true)} onLock={lock} />
        : <AccessOptions saved={saved} progress={progress} onOpen={startAccess} />}
      {error && <p className="mt-4 rounded-lg bg-[#fff1f1] p-3 text-[14px] text-[#a32424]" role="alert">{error}</p>}
    </article>
  </div>;
}

function CredentialsPanel({ records, onPreview, onLock }: {
  records: CredentialMetadata[];
  onPreview: () => void;
  onLock: () => void;
}) {
  const hasSelfie = records.some(record => record.issuerSchemaId === 11n && !record.isExpired);
  return <div className="flex flex-1 flex-col pt-6">
    <div className="relative flex items-center gap-3 overflow-hidden py-3">
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40 [background:repeating-radial-gradient(circle_at_16%_128%,rgba(10,92,254,.13)_0_1px,transparent_1px_7px)]" />
      <span className="relative grid size-[52px] place-items-center rounded-full bg-[#0a5cfe]"><img className="size-9" src="/assets/brand/human-badge.svg" alt="" /></span>
      <div className="relative"><h1 className="text-[18px] font-medium">Your authenticator</h1><p className="text-[13px] text-[#5c6879]">Browser passkey</p></div>
      <span className="ml-auto text-[12px] text-[#0d7a54]">Active</span>
    </div>
    <div className="flex justify-between border-b border-[#d6dde7] pt-4 pb-2 text-[13px]"><h2 className="font-medium">Credentials</h2><span className="text-[#657184]">{records.length} saved</span></div>
    <p className="sr-only">{records.length} credential{records.length === 1 ? "" : "s"} in your authenticator.</p>
    <ul>{records.map(record => <li key={record.credentialId.toString()} className="flex items-center gap-3 border-b border-[#d6dde7] py-4">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full border border-[#c3cddb] text-[22px] text-[#0a5cfe]">◎</span>
      <span className="flex-1 text-[16px]">{record.issuerSchemaId === 11n ? "Selfie Check" : record.issuerSchemaId === 1n ? "Orb" : record.issuerSchemaId === 128n ? "Faux" : "Credential"}</span>
      <span className={record.isExpired ? "text-[12px] text-[#657184]" : "text-[12px] text-[#0d7a54]"}>{record.isExpired ? "Expired" : "Active"}</span>
    </li>)}</ul>
    {!hasSelfie && <><div className="flex justify-between border-b border-[#d6dde7] pt-6 pb-2 text-[13px]"><h2 className="font-medium">Add to this World ID</h2></div>
      <div className="flex items-center gap-3 border-b border-[#d6dde7] py-4"><span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full border border-dashed border-[#b9c4d4] text-[22px] text-[#657184]">+</span><div className="flex-1"><p className="text-[16px]">Selfie Check</p><p className="text-[12px] text-[#5c6879]">Verify with a selfie</p></div><button className="min-h-11 rounded-lg border border-[#c9d2df] px-3 text-[14px]" onClick={onPreview}>Set up Selfie Check</button></div>
      <p className="mt-3 rounded-lg bg-[#f4f7fc] p-3 text-[12px] leading-[1.45] text-[#5e6f88]">Selfie Check setup is not available yet. You can try the camera preview; it won’t issue a credential.</p></>}
    <button className="mt-auto self-start pt-6 text-[14px] text-[#5c6879] underline-offset-4 hover:underline" onClick={onLock}>Lock authenticator</button>
  </div>;
}

function AccessOptions({ saved, progress, onOpen }: {
  saved: boolean;
  progress: string | null;
  onOpen: (mode: "open" | "create") => Promise<void>;
}) {
  const disabledAction = "disabled:cursor-not-allowed disabled:border-[#d6dde7] disabled:bg-[#e7ebf0] disabled:text-[#657184] disabled:opacity-100";
  const button = "flex min-h-[52px] w-full items-center justify-center rounded-[11px] border px-4 text-[16px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a5cfe]";
  return <div className="flex flex-1 flex-col pt-9">
    <h1 className="text-[40px] leading-[1.04] tracking-[-.033em]">Your World ID,<br />in this browser.</h1>
    <p className="mt-4 max-w-[22em] text-[16px] leading-[1.45] text-[#5c6879]">Sign in with your saved passkey, or create a new World ID.</p>
    {progress !== null ? <div className="mt-8 flex items-center gap-3 text-[15px] text-[#5c6879]" role="status" aria-live="polite">
      <span aria-hidden="true" className="size-6 shrink-0 rounded-full border-2 border-[#d6dde7] border-t-[#0a5cfe] motion-safe:animate-spin" />
      <span>{progress}</span>
    </div> : <div className="mt-8 grid gap-2">
      <button className={`${button} border-[#0a5cfe] bg-[#0a5cfe] text-white enabled:hover:bg-[#0846c2] ${disabledAction}`} disabled={!saved} onClick={() => void onOpen("open")}>Sign in with passkey</button>
      <button className={`${button} border-[#c9d2df] bg-white enabled:hover:bg-[#f5f8fd] ${disabledAction}`} disabled={saved} onClick={() => void onOpen("create")}>Create a new World ID</button>
      <button className={`${button} cursor-not-allowed border-[#dde3ec] bg-[#e7ebf0] text-[#657184] disabled:opacity-100`} disabled>Link an authenticator (coming soon)</button>
      <p className="mt-1 text-[13px] text-[#657184]">Linking an authenticator isn’t available yet.</p>
    </div>}
    <p className="mt-auto border-t border-[#d6dde7] pt-4 text-[12px] leading-[1.5] text-[#657184]">Use your passkey to unlock your authenticator in this browser.</p>
  </div>;
}
