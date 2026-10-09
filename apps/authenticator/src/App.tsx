import { useEffect, useRef, useState } from "react";
import { CameraPreview } from "./components/CameraPreview";
import { openAuthenticator } from "./wallet/session";
import { abortable } from "./lib/async";
import type { WalletKit, CredentialMetadata } from "./lib/walletkit";
import { issueSelfieCredential } from "./lib/selfie-issuance";
import { loadIncomingRequest, type IncomingRequest } from "./lib/requests/incoming-request";
import { credentialAvailability, credentialRequirementsLabel } from "./lib/requests/proof-request";
import { createProof } from "./lib/requests/prove";

const defaults = { open: openAuthenticator, load: loadIncomingRequest, issue: issueSelfieCredential, prove: createProof };
type Screen = "review" | "enroll" | "delivery" | "done" | "cancelled";

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
  const [canIssue, setCanIssue] = useState(false);
  const [configurationError, setConfigurationError] = useState(false);
  const [preview, setPreview] = useState(false);
  const [expired, setExpired] = useState(false);
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
    void fetch("/api/capabilities", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Configuration unavailable");
        const value = await response.json() as { environment?: unknown; syntheticSelfieIssuance?: unknown };
        if (value.environment !== "staging" || typeof value.syntheticSelfieIssuance !== "boolean") throw new Error("Invalid configuration");
        if (!controller.signal.aborted) setCanIssue(value.syntheticSelfieIssuance);
      }).catch(() => { if (!controller.signal.aborted) setConfigurationError(true); });
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
      closeWallet();
      throw new Error("Could not read the encrypted vault. Unlock again to retry.", { cause });
    }
  }

  const unlock = () => run(async signal => {
    setProgress("Use your passkey to open your wallet…");
    let current: WalletKit;
    try { current = await services.open(signal, setProgress); }
    catch (cause) {
      throw new Error(cause instanceof Error && cause.message.startsWith("Could not ")
        ? cause.message : "Passkey setup or unlock did not complete. Use a PRF-capable passkey provider and try again.", { cause });
    }
    if (signal.aborted) { current.terminate(); signal.throwIfAborted(); }
    activeWallet.current = current; setWallet(current);
    const next = await refresh(current, signal);
    if (incoming && credentialAvailability(incoming.proof, next).needsSelfieEnrollment && supported) setScreen("enroll");
    setProgress("Wallet unlocked.");
  });

  const issue = () => run(async signal => {
    if (!wallet || !canIssue || !supported || (incoming && !availability?.canEnrollSelfie)) return;
    setPreview(false);
    try { await services.issue(wallet, signal, setProgress); }
    catch (cause) {
      closeWallet();
      throw new Error(cause instanceof Error ? cause.message : "Issuance failed. Unlock and retry to resume the same operation.", { cause });
    }
    await refresh(wallet, signal);
    setScreen("review");
    setProgress("Selfie credential stored in your encrypted wallet.");
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
    setPreview(false); setScreen("cancelled"); setProgress(""); closeWallet();
  });

  const title = loading ? "Checking your request" : loadFailed ? "Request unavailable"
    : screen === "done" ? "Proof response sent" : screen === "cancelled" ? "Request cancelled"
    : screen === "delivery" ? "Sending your proof" : screen === "enroll" ? "Set up Selfie Check"
    : incoming ? "Review your request" : wallet ? "Your World ID wallet" : "World ID authenticator";
  const finished = screen === "done" || screen === "cancelled";

  return <main className="app-main">
    <p className="staging-banner">World ID · Staging</p>
    <div className="screen-content"><div className="centered-layout">
      <img className="hero-icon" src={`/assets/figma/${screen === "done" ? "success-emblem" : "person-key-blue"}.svg`} alt="" />
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
        {expired && !finished && <p role="alert">This request expired. Start a new request at the requesting app.</p>}
        {wallet && screen === "review" && <section className="request-details" aria-label="Wallet credentials">
          <p>{records.length ? `${records.length} credential${records.length === 1 ? "" : "s"} in your encrypted wallet.` : "No credentials in your encrypted wallet yet."}</p>
          {availability && !availability.satisfied && <p>{availability.canEnrollSelfie
            ? availability.needsSelfieEnrollment ? "This request needs Selfie Check." : "Choose Selfie Check, or use another accepted credential from the requesting app."
            : availability.requiresOrb ? "This request needs an eligible Orb credential. Orb enrollment and transfer are not available here."
            : "Your wallet does not meet the requested credential and date requirements."}</p>}
        </section>}
        {screen === "enroll" && <p className="detail-copy">This local flow issues a real staging credential using synthetic face data. Camera preview is optional; face verification and TEE issuance are not connected yet.</p>}
        {configurationError && <p role="alert">Issuance configuration is unavailable. Reload to retry; request verification can still continue.</p>}
        {screen === "enroll" && !canIssue && <p>Staging enrollment is available only when running this authenticator locally.</p>}
        {!wallet && supported && !loading && !finished && screen !== "delivery" && <p className="detail-copy">New wallets register an account on staging. Your passkey also unlocks encrypted credential storage on this browser.</p>}
      </div>
      {preview && screen === "enroll" && <CameraPreview />}
      {progress && !finished && <p className="progress-copy" role="status">{progress}</p>}
      {error && <p className="error-copy" role="alert">{error}</p>}
    </div></div>
    <div className="actions">
      {!loading && !finished && screen !== "delivery" && <>
        {!wallet && supported && <button className="primary-action" disabled={busy} onClick={() => void unlock()}>{busy ? "Opening wallet…" : "Create or unlock with passkey"}</button>}
        {wallet && screen === "review" && incoming && supported && <button className="primary-action" disabled={busy || !availability?.satisfied} onClick={() => void approve()}>Approve and share proof</button>}
        {wallet && screen === "review" && supported && (incoming ? availability?.canEnrollSelfie : !hasSelfie) && <button className="secondary-action" disabled={busy} onClick={() => { setScreen("enroll"); setError(null); }}>Set up Selfie Check</button>}
        {wallet && screen === "enroll" && supported && <>
          <button className="primary-action" disabled={busy || !canIssue} onClick={() => void issue()}>Issue staging Selfie credential</button>
          <button className="secondary-action" disabled={busy} onClick={() => setPreview(value => !value)}>{preview ? "Close camera preview" : "Open camera preview"}</button>
          <button className="secondary-action" disabled={busy} onClick={() => { setScreen("review"); setPreview(false); }}>Back to wallet</button>
        </>}
        {incoming && <button className="secondary-action" disabled={busy} onClick={() => void cancel()}>Cancel request</button>}
        {wallet && !incoming && screen === "review" && <button className="secondary-action" disabled={busy} onClick={closeWallet}>Lock wallet</button>}
      </>}
      {screen === "delivery" && <button className="primary-action" disabled={busy || expired} onClick={() => void run(deliver)}>{busy ? "Sending…" : "Retry sending proof"}</button>}
      {finished && incoming?.returnUrl && <a className="primary-action return-link" href={incoming.returnUrl}>Return to requesting app</a>}
      {(finished || loadFailed) && <a className="secondary-action return-link" href="/">Open authenticator</a>}
    </div>
  </main>;
}
