import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DeveloperPanel } from "./components/DeveloperPanel";
import { ConsentScreen } from "./components/ConsentScreen";
import { hasConnector } from "./lib/connector";
import { consentClient, type ConsentChoice, type ConsentClient, type ConsentState } from "./lib/consent";
import { hasSavedWallet, openAuthenticator } from "./lib/wallet-session";
import { WalletRegistrationError, walletOpenErrorMessage } from "./lib/wallet-errors";
import { abortable } from "./lib/async";
import type { WalletKit, CredentialMetadata } from "./lib/walletkit";
import { loadIncomingRequest, type IncomingRequest } from "./lib/incoming-request";
import { credentialAvailability, RequestExpiredError } from "./lib/proof-request";
import { createProof } from "./lib/prove";
import { PublicRequestFlow } from "./PublicRequestFlow";

const defaults = { open: openAuthenticator, load: loadIncomingRequest, prove: createProof };
// Dev-mode only: local camera capture, loaded on demand so the detector runtime stays out of the main bundle.
const SelfieCheck = lazy(() => import("./components/SelfieCheck"));
type Screen = "review" | "enroll" | "delivery" | "done" | "cancelled" | "wallet-timeout" | "wallet-error";

export function AuthenticatorAppV1({ services = defaults, consent = consentClient }: { services?: typeof defaults; consent?: ConsentClient }) {
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
  // null until the server answers; analytics stays off unless the state is "granted".
  const [consentState, setConsentState] = useState<ConsentState | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Read before the effect strips the query: was this page opened from a request link?
  const [requestLink] = useState(() => hasConnector(window.location.href));
  const [loadExpired, setLoadExpired] = useState(false);
  const [started, setStarted] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const activeWallet = useRef<WalletKit | null>(null);
  const retainedProof = useRef<string | null>(null);
  const source = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // An unreachable consent endpoint shows the choice again rather than assuming one.
    consent.read(controller.signal).then(setConsentState, () => { if (!controller.signal.aborted) setConsentState("unset"); });
    return () => controller.abort();
  }, [consent]);

  const chooseConsent = async (choice: ConsentChoice) => {
    setConsentBusy(true); setConsentError(null);
    try {
      setConsentState(await consent.save(choice));
      setConsentOpen(false);
    } catch {
      setConsentError("Your choice couldn’t be saved. Try again.");
    } finally {
      setConsentBusy(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    source.current ??= window.location.href;
    const url = new URL(source.current);
    // Keep the response capability in memory; remove the bridge key from browser history immediately.
    if (url.searchParams.has("k")) window.history.replaceState(null, "", window.location.pathname);
    void services.load(source.current, controller.signal, setProgress).then(request => {
      if (!controller.signal.aborted) { source.current = null; setIncoming(request); setLoading(false); setProgress(""); }
    }).catch(cause => {
      if (!controller.signal.aborted) {
        source.current = null;
        setError(cause instanceof Error ? cause.message : "Could not validate the incoming request.");
        setLoadExpired(cause instanceof RequestExpiredError);
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
    } finally { if (operation.current === controller) { operation.current = null; if (!controller.signal.aborted) setBusy(false); } }
  }

  async function refresh(current: WalletKit, signal: AbortSignal) {
    try {
      const next = await abortable(current.listCredentials(), AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
      signal.throwIfAborted(); setRecords(next);
      return next;
    } catch (cause) {
      if (!signal.aborted && activeWallet.current === current) { closeWallet(); setProgress(""); }
      throw new Error("Could not read the encrypted vault. Unlock again to retry.", { cause });
    }
  }

  const unlock = () => run(async signal => {
    setScreen("review");
    setProgress("Waiting for your passkey…");
    let current: WalletKit;
    try { current = await services.open(signal, message => { if (!signal.aborted) setProgress(message); }); }
    catch (cause) {
      signal.throwIfAborted();
      setProgress("");
      if (cause instanceof WalletRegistrationError) setScreen(cause.timedOut ? "wallet-timeout" : "wallet-error");
      throw new Error(walletOpenErrorMessage(cause), { cause });
    }
    if (signal.aborted) { current.terminate(); signal.throwIfAborted(); }
    activeWallet.current = current; setWallet(current);
    const next = await refresh(current, signal);
    if (incoming && credentialAvailability(incoming.proof, next).needsSelfieEnrollment && supported) setScreen("enroll");
    setProgress("");
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
    try {
      const proof = await services.prove(incoming, wallet, signal, message => { if (!signal.aborted) setProgress(message); });
      signal.throwIfAborted(); retainedProof.current = proof;
    } catch (cause) { if (!signal.aborted) closeWallet(); throw cause; }
    setScreen("delivery");
    await deliver(signal);
  });

  const cancel = () => run(async signal => {
    if (incoming) {
      try { await incoming.cancel(AbortSignal.any([signal, AbortSignal.timeout(15_000)])); }
      catch (cause) { throw new Error("Could not send the rejection. Retry cancellation or close this tab and let the request expire.", { cause }); }
    }
    signal.throwIfAborted(); setScreen("cancelled"); setProgress(""); closeWallet();
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
      if (!signal.aborted) { closeWallet(); setProgress(""); }
      throw new Error("Credential deletion could not be confirmed. Unlock again to check the vault before retrying.", { cause });
    }
    await refresh(wallet, signal);
    setProgress("Local credential deleted.");
  });

  const devToggle = <button className="dev-mode-switch" role="switch" aria-checked={devMode} aria-controls={devMode ? "developer-panel" : undefined} onClick={() => {
    operation.current?.abort(); operation.current = null;
    closeWallet();
    retainedProof.current = null;
    setBusy(false); setProgress(""); if (!loadFailed) setError(null); setScreen("review"); setStarted(false);
    setDevMode(value => !value); setCameraOpen(false);
  }}>Dev mode <span aria-hidden="true">{devMode ? "On" : "Off"}</span></button>;
  const footerActions = <span className="footer-actions">
    <button className="footer-link" onClick={() => { setConsentError(null); setConsentOpen(true); }}>Privacy choices</button>
    {devToggle}
  </span>;

  // A first visit (no recorded choice) sees the consent screen before anything else. Request
  // validation keeps running behind it, so the request link is ready once the user chooses.
  const consentScreen = consentState === "unset" || consentOpen;
  // The camera exists only behind dev mode; turning dev mode off closes it.
  const camera = devMode && cameraOpen && !consentScreen && consentState !== null;

  if (!devMode) return <div className="authenticator-shell authenticator-shell--public">
    <div className="authenticator-layout"><main className="app-main app-main--landing">
      {consentState === null ? null
        : consentScreen ? <ConsentScreen busy={consentBusy} error={consentError} footerActions={devToggle} onChoose={choice => void chooseConsent(choice)} />
        : <PublicRequestFlow incoming={incoming} requested={requestLink} loading={loading} failed={loadFailed} expired={loadExpired || expired}
          footerActions={footerActions} devToggle={devToggle} onSave={services.open} onDispose={() => { setIncoming(null); source.current = null; }} />}
    </main></div>
  </div>;

  return <div className="authenticator-shell authenticator-shell--dev developer-workspace">
    {consentState !== null && !consentScreen && <header className="dev-mode-bar"><p className="brand-label">World ID</p>{devToggle}</header>}
    <main className="developer-main">
      {consentState === null ? null : consentScreen ? <ConsentScreen busy={consentBusy} error={consentError} footerActions={devToggle} onChoose={choice => void chooseConsent(choice)} /> : <>
        <header className="developer-heading"><h1>Developer tools</h1><p>Inspect your local vault and test credentials on staging.</p></header>
        <section className="developer-account" aria-labelledby="account-title">
          <h2 id="account-title">Authenticator access</h2>
          <p>{wallet ? "Your local credential vault is unlocked." : "Use a passkey to create or unlock your local staging authenticator."}</p>
          {!wallet ? <button disabled={busy} onClick={() => { setStarted(true); void unlock(); }}>{busy ? "Opening wallet…" : screen === "wallet-timeout" || screen === "wallet-error" ? "Retry wallet setup" : incoming && !started ? "Start check" : hasSavedWallet() ? "Sign in with passkey" : "Continue with passkey"}</button>
            : <button disabled={busy || screen === "delivery"} onClick={closeWallet}>Lock wallet</button>}
          {progress && !finished && !deliveryExpired && <p className="progress-copy" role="status">{progress}</p>}
          {error && !deliveryExpired && <p className="error-copy" role="alert">{error}</p>}
          {!incoming && (screen === "wallet-timeout" || screen === "wallet-error") && <h3>{title}</h3>}
        </section>
        <DeveloperPanel key={wallet ? "unlocked" : "locked"} records={records} unlocked={!!wallet} disabled={vaultDisabled} incoming={incoming} onRefresh={() => void refreshVault()} onDelete={id => void deleteCredential(id)} onOpenCamera={camera || busy ? undefined : () => setCameraOpen(true)}>
          {incoming || loadFailed ? <section className="developer-request" aria-label="Request proof tools">
            <h2>{title}</h2>
            {screen === "done" && <p>Your proof reached the bridge. The requesting app verifies it.</p>}
            {screen === "cancelled" && <p>No proof was sent. You can return to the requesting app.</p>}
            {incoming?.unsupportedReason && <p role="alert">{incoming.unsupportedReason}</p>}
            {expired && !finished && <p role="alert">{deliveryExpired ? "This request expired. Proof delivery is unconfirmed. Check the requesting app before starting a new request." : "This request expired. Start a new request at the requesting app."}</p>}
            {wallet && screen === "review" && availability && !availability.satisfied && <p>{availability.canEnrollSelfie ? availability.needsSelfieEnrollment ? "This request needs Selfie Check." : "Choose Selfie Check, or use another accepted credential from the requesting app." : availability.requiresOrb ? "This request needs an eligible Orb credential. Orb enrollment and transfer are not available here." : "Your wallet does not meet the requested credential and date requirements."}</p>}
            {screen === "enroll" && <p>Selfie Check enrollment is not connected yet.</p>}
            <div className="dev-toolbar">
              {wallet && screen === "review" && incoming && supported && <button disabled={busy || !availability?.satisfied} onClick={() => void approve()}>Approve and share proof</button>}
              {wallet && screen === "review" && supported && availability?.canEnrollSelfie && <button disabled={busy} onClick={() => { setScreen("enroll"); setError(null); }}>Set up Selfie Check</button>}
              {wallet && screen === "enroll" && supported && <button disabled={busy} onClick={() => setScreen("review")}>Back to wallet</button>}
              {incoming && !finished && screen !== "delivery" && <button disabled={busy} onClick={() => void cancel()}>Cancel request</button>}
              {screen === "delivery" && <button disabled={busy || expired} onClick={() => void run(deliver)}>{busy && !expired ? "Sending…" : "Retry sending proof"}</button>}
              {(finished || expired) && incoming?.returnUrl && <a href={incoming.returnUrl} onClick={deliveryExpired ? leaveDelivery : undefined}>Return to requesting app</a>}
              {(finished || loadFailed || expired || screen === "wallet-timeout" || screen === "wallet-error") && <a href="/" onClick={deliveryExpired ? leaveDelivery : undefined}>Open authenticator</a>}
            </div>
          </section> : null}
          {camera && <section className="developer-camera"><Suspense fallback={<p role="status">Opening Selfie Check…</p>}><SelfieCheck onClose={() => setCameraOpen(false)} backLabel="Back to authenticator" diagnostics /></Suspense></section>}
        </DeveloperPanel>
      </>}
    </main>
  </div>;
}
