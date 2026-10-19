import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DeveloperPanel } from "./components/DeveloperPanel";
import { openAuthenticator } from "./lib/wallet-session";
import { WalletRegistrationError, walletOpenErrorMessage } from "./lib/wallet-errors";
import { abortable } from "./lib/async";
import type { WalletKit, CredentialMetadata } from "./lib/walletkit";
import { loadIncomingRequest, type IncomingRequest } from "./lib/incoming-request";
import { credentialAvailability, credentialRequirementsLabel } from "./lib/proof-request";
import { createProof } from "./lib/prove";

// Dev-mode only: local camera capture, loaded on demand so the detector runtime stays out of the main bundle.
const SelfieCheck = lazy(() => import("./components/SelfieCheck"));

const defaults = { open: openAuthenticator, load: loadIncomingRequest, prove: createProof };
type Screen = "review" | "enroll" | "delivery" | "done" | "cancelled" | "wallet-timeout" | "wallet-error";

export function AuthenticatorAppV1({ services = defaults }: { services?: typeof defaults }) {
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<WalletKit | null>(null);
  const [records, setRecords] = useState<CredentialMetadata[]>([]);
  const [screen, setScreen] = useState<Screen>("review");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const activeWallet = useRef<WalletKit | null>(null);
  const retainedProof = useRef<string | null>(null);
  const source = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    source.current ??= window.location.href;
    const url = new URL(source.current);
    // Keep the response capability in memory; remove the bridge key from browser history immediately.
    if (url.searchParams.has("k")) window.history.replaceState(null, "", window.location.pathname);
    void services.load(source.current, controller.signal, setProgress).then(request => {
      if (!controller.signal.aborted) { setIncoming(request); setLoading(false); setProgress(""); }
    }).catch(cause => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Could not validate the incoming request.");
        setLoadFailed(true);
        setLoading(false);
      }
    });
    const stop = () => {
      controller.abort();
      operation.current?.abort();
      activeWallet.current?.terminate();
      retainedProof.current = null;
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", restore);
    return () => { stop(); window.removeEventListener("pagehide", stop); window.removeEventListener("pageshow", restore); };
  }, [services]);

  useEffect(() => {
    if (!incoming || screen === "done" || screen === "cancelled") return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, incoming.proof.expires_at * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [incoming, screen]);

  const availability = incoming && wallet ? credentialAvailability(incoming.proof, records) : null;
  const hasSelfie = records.some(record => record.issuerSchemaId === 11n && !record.isExpired);
  const supported = !incoming?.unsupportedReason && !expired && !loadFailed;
  const closeWallet = () => { activeWallet.current?.terminate(); activeWallet.current = null; setWallet(null); setRecords([]); };

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true); setError(null);
    try { await action(controller.signal); }
    catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The operation could not complete. Try again.");
    } finally { if (operation.current === controller) operation.current = null; setBusy(false); }
  }

  async function refresh(current: WalletKit, signal: AbortSignal) {
    try {
      const next = await abortable(current.listCredentials(), AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
      signal.throwIfAborted(); setRecords(next);
      return next;
    } catch (cause) {
      closeWallet(); setProgress("");
      throw new Error("Could not read the encrypted vault. Unlock again to retry.", { cause });
    }
  }

  const unlock = () => run(async signal => {
    setScreen("review");
    setProgress("Use your passkey to open your wallet…");
    let current: WalletKit;
    try { current = await services.open(signal, setProgress); }
    catch (cause) {
      setProgress("");
      if (cause instanceof WalletRegistrationError) setScreen(cause.timedOut ? "wallet-timeout" : "wallet-error");
      throw new Error(walletOpenErrorMessage(cause), { cause });
    }
    if (signal.aborted) { current.terminate(); signal.throwIfAborted(); }
    activeWallet.current = current; setWallet(current);
    const next = await refresh(current, signal);
    if (incoming && credentialAvailability(incoming.proof, next).needsSelfieEnrollment && supported) setScreen("enroll");
    setProgress("Wallet unlocked.");
  });

  async function deliver(signal: AbortSignal) {
    if (!incoming || !retainedProof.current) return;
    setProgress("Encrypting and sending your proof…");
    try { await incoming.deliver(retainedProof.current, signal); }
    catch (cause) { throw new Error("Proof delivery is unconfirmed. Retry sending the same proof; no new proof is needed.", { cause }); }
    signal.throwIfAborted();
    retainedProof.current = null; setScreen("done"); setProgress(""); closeWallet();
  }

  const approve = () => run(async signal => {
    if (!wallet || !incoming || !availability?.satisfied || !supported) return;
    try { retainedProof.current = await services.prove(incoming, wallet, signal, setProgress); }
    catch (cause) { closeWallet(); throw cause; }
    setScreen("delivery");
    await deliver(signal);
  });

  const cancel = () => run(async signal => {
    if (incoming) {
      try { await incoming.cancel(AbortSignal.any([signal, AbortSignal.timeout(15_000)])); }
      catch (cause) { throw new Error("Could not send the rejection. Retry cancellation or close this tab and let the request expire.", { cause }); }
    }
    setScreen("cancelled"); setProgress(""); closeWallet();
  });

  const deliveryExpired = screen === "delivery" && expired;
  const leaveDelivery = () => {
    operation.current?.abort();
    retainedProof.current = null;
    closeWallet();
  };

  const title = loading ? "Checking your request" : loadFailed ? "Request unavailable"
    : screen === "done" ? "Proof response sent" : screen === "cancelled" ? "Request cancelled"
    : deliveryExpired ? "Request expired"
    : screen === "wallet-timeout" ? "Wallet setup timed out" : screen === "wallet-error" ? "Wallet setup interrupted"
    : screen === "delivery" ? "Sending your proof" : screen === "enroll" ? "Set up Selfie Check"
    : incoming ? "Review your request" : wallet ? "Your World ID wallet" : "World ID authenticator";
  const finished = screen === "done" || screen === "cancelled";
  const vaultDisabled = busy || screen === "delivery" || finished;

  const refreshVault = () => run(async signal => {
    if (!wallet || vaultDisabled) return;
    await refresh(wallet, signal);
    setProgress("Credential vault refreshed.");
  });
  const deleteCredential = (id: bigint) => run(async signal => {
    if (!wallet || vaultDisabled || !records.some(record => record.credentialId === id)) return;
    setProgress("Deleting local credential…");
    try {
      await abortable(wallet.deleteCredential(id), AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
      signal.throwIfAborted();
    } catch (cause) {
      closeWallet(); setProgress("");
      throw new Error("Credential deletion could not be confirmed. Unlock again to check the vault before retrying.", { cause });
    }
    await refresh(wallet, signal);
    setProgress("Local credential deleted.");
  });

  // The camera exists only behind dev mode; turning dev mode off closes it.
  const camera = devMode && cameraOpen;

  return <div className={`authenticator-shell${devMode ? " authenticator-shell--dev" : ""}`}>
    <header className="dev-mode-bar"><p className="brand-label">World ID</p><button className="dev-mode-switch" role="switch" aria-checked={devMode} aria-controls={devMode ? "developer-panel" : undefined} onClick={() => { setDevMode(value => !value); setCameraOpen(false); }}>Dev mode <span aria-hidden="true">{devMode ? "On" : "Off"}</span></button></header>
    <div className="authenticator-layout"><main className={`app-main${camera ? " app-main--capture" : ""}`}>
    {camera ? <Suspense fallback={<p role="status">Opening Selfie Check…</p>}><SelfieCheck onClose={() => setCameraOpen(false)} backLabel="Back to authenticator" diagnostics /></Suspense> : <>
    <div className="screen-content"><div className="centered-layout">
      <img className="hero-icon" src={`/assets/figma/${screen === "done" ? "success-emblem" : "human-emblem"}.svg`} alt="" />
      <div className="message-block">
        <h1>{title}</h1>
        {screen === "done" && <p>Your proof reached the bridge. The requesting app verifies it.</p>}
        {screen === "cancelled" && <p>No proof was sent. You can return to the requesting app.</p>}
        {!incoming && !loading && !loadFailed && !finished && <p>Open a request from your app, or unlock your wallet to manage your credentials.</p>}
        {incoming && !finished && <section className="request-details" aria-label="Request details">
          <p><strong>Requesting RP</strong><br />{incoming.label}</p>
          <p><strong>Action</strong><br />{incoming.actionLabel || "No action label"}</p>
          <p><strong>Accepted credentials</strong><br />{credentialRequirementsLabel(incoming.proof)}</p>
          <p className="detail-copy">RP signature checked against the staging registry. Your passkey and secret keys stay in your wallet.</p>
          {incoming.proof.proof_requests.some(item => item.issuer_schema_id === 11) && <p className="detail-copy">A Selfie Check proof also shares the credential’s uniqueness score.</p>}
        </section>}
        {incoming?.unsupportedReason && <p role="alert">{incoming.unsupportedReason}</p>}
        {expired && !finished && <p role="alert">{deliveryExpired
          ? "This request expired. Proof delivery is unconfirmed. Check the requesting app before starting a new request."
          : "This request expired. Start a new request at the requesting app."}</p>}
        {wallet && screen === "review" && <section className="request-details" aria-label="Wallet credentials">
          <p>{records.length ? `${records.length} credential${records.length === 1 ? "" : "s"} in your encrypted wallet.` : "No credentials in your encrypted wallet yet."}</p>
          {availability && !availability.satisfied && <p>{availability.canEnrollSelfie
            ? availability.needsSelfieEnrollment ? "This request needs Selfie Check." : "Choose Selfie Check, or use another accepted credential from the requesting app."
            : availability.requiresOrb ? "This request needs an eligible Orb credential. Orb enrollment and transfer are not available here."
            : "Your wallet does not meet the requested credential and date requirements."}</p>}
        </section>}
        {screen === "enroll" && <p className="detail-copy">Selfie Check enrollment is not available in this app yet.</p>}
      </div>
      {progress && !finished && !deliveryExpired && <p className="progress-copy" role="status">{progress}</p>}
      {error && !deliveryExpired && <p className="error-copy" role="alert">{error}</p>}
    </div></div>
    <div className="actions">
      {!loading && !finished && screen !== "delivery" && <>
        {!wallet && supported && <button className="primary-action" disabled={busy} onClick={() => void unlock()}>{busy ? "Opening wallet…" : screen === "wallet-timeout" || screen === "wallet-error" ? "Retry wallet setup" : "Create or unlock with passkey"}</button>}
        {wallet && screen === "review" && incoming && supported && <button className="primary-action" disabled={busy || !availability?.satisfied} onClick={() => void approve()}>Approve and share proof</button>}
        {wallet && screen === "review" && supported && (incoming ? availability?.canEnrollSelfie : !hasSelfie) && <button className="secondary-action" disabled={busy} onClick={() => { setScreen("enroll"); setError(null); }}>Set up Selfie Check</button>}
        {wallet && screen === "enroll" && supported && <>
          <button className="secondary-action" disabled={busy} onClick={() => setScreen("review")}>Back to wallet</button>
        </>}
        {incoming && <button className="secondary-action" disabled={busy} onClick={() => void cancel()}>Cancel request</button>}
        {wallet && !incoming && screen === "review" && <button className="secondary-action" disabled={busy} onClick={closeWallet}>Lock wallet</button>}
      </>}
      {screen === "delivery" && <button className="primary-action" disabled={busy || expired} onClick={() => void run(deliver)}>{busy && !expired ? "Sending…" : "Retry sending proof"}</button>}
      {(finished || expired) && incoming?.returnUrl && <a className="primary-action return-link" href={incoming.returnUrl} onClick={deliveryExpired ? leaveDelivery : undefined}>Return to requesting app</a>}
      {(finished || loadFailed || expired || screen === "wallet-timeout" || screen === "wallet-error") && <a className="secondary-action return-link" href="/" onClick={deliveryExpired ? leaveDelivery : undefined}>Open authenticator</a>}
    </div>
    </>}
    </main>
    {devMode && <DeveloperPanel key={wallet ? "unlocked" : "locked"} records={records} unlocked={!!wallet} disabled={vaultDisabled} incoming={incoming} onRefresh={() => void refreshVault()} onDelete={id => void deleteCredential(id)} onOpenCamera={camera || busy ? undefined : () => setCameraOpen(true)} />}
    </div>
  </div>;
}
