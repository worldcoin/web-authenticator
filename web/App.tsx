import { useEffect, useRef, useState } from "react";
import { AppLayout } from "./components/AppLayout";
import { ConsentScreen } from "./components/ConsentScreen";
import { hasConnector } from "./lib/connector";
import { consentClient, type ConsentChoice, type ConsentClient, type ConsentState } from "./lib/consent";
import { openAuthenticator } from "./lib/wallet-session";
import { loadIncomingRequest, publicRequestUnsupportedReason, type IncomingRequest } from "./lib/incoming-request";
import { RequestExpiredError } from "./lib/proof-request";
import { PublicRequestFlow } from "./PublicRequestFlow";
import { analytics } from "./lib/analytics";

const defaults = { open: openAuthenticator, load: loadIncomingRequest };
export function AuthenticatorAppV1({ services = defaults, consent = consentClient }: { services?: typeof defaults; consent?: ConsentClient }) {
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [completionAnimating, setCompletionAnimating] = useState(false);
  // null until the server answers; analytics stays off unless the state is "granted".
  const [consentState, setConsentState] = useState<ConsentState | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Read before the effect strips the query: was this page opened from a request link?
  const [requestLink] = useState(() => hasConnector(window.location.href));
  const [loadExpired, setLoadExpired] = useState(false);
  const source = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // An unreachable consent endpoint shows the choice again rather than assuming one.
    consent.read(controller.signal).then(state => {
      if (controller.signal.aborted) return;
      analytics.setConsent(state, requestLink ? "deeplink" : "direct");
      setConsentState(state);
    }, () => { if (!controller.signal.aborted) { analytics.setConsent("unset"); setConsentState("unset"); } });
    return () => { controller.abort(); analytics.setConsent(null); };
  }, [consent, requestLink]);

  useEffect(() => {
    const leave = () => { analytics.setBackground(true); };
    const visibility = () => { analytics.setBackground(document.hidden); };
    const online = () => { void analytics.flush(); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", leave); window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (consentState !== "granted" || (!requestLink && !incoming && !loadFailed)) return;
    // Observe the current request after consent; do not buffer activity before consent.
    analytics.once("request", "started");
    if (!loading && loadFailed) analytics.once("request", "failed", loadExpired ? "expired" : "invalid_data");
    else if (!loading && incoming) {
      analytics.once("request", "completed");
      if (!expired) {
        const unsupported = publicRequestUnsupportedReason(incoming);
        analytics.once("request_eligibility", unsupported ? "failed" : "completed", unsupported ? "unsupported" : undefined);
      }
    }
    if (expired) analytics.once("request_expiry", "completed", "expired");
  }, [consentState, requestLink, incoming, loading, loadFailed, loadExpired, expired]);

  const chooseConsent = async (choice: ConsentChoice) => {
    // Stop immediately on opt-out, including when saving the preference fails.
    if (choice === "denied") analytics.setConsent("denied");
    setConsentBusy(true); setConsentError(null);
    try {
      const state = await consent.save(choice);
      analytics.setConsent(state, requestLink ? "deeplink" : "direct");
      setConsentState(state);
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
    void services.load(source.current, controller.signal, () => {}).then(request => {
      if (!controller.signal.aborted) { source.current = null; setIncoming(request); setLoading(false); }
    }).catch(cause => {
      if (!controller.signal.aborted) {
        source.current = null;
        setLoadExpired(cause instanceof RequestExpiredError);
        setLoadFailed(true);
        setLoading(false);
      }
    });
    const stop = () => controller.abort();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", restore);
    return () => { stop(); window.removeEventListener("pagehide", stop); window.removeEventListener("pageshow", restore); };
  }, [services]);

  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, incoming.proof.expires_at * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [incoming]);

  // A first visit (no recorded choice) sees the consent screen before anything else. Request
  // validation keeps running behind it, so the request link is ready once the user chooses.
  const consentScreen = consentState === "unset" || consentOpen;

  const footerActions = <span className="footer-actions">
    {consentState !== null && consentState !== "unset" && !consentOpen && <button className="footer-link" onClick={() => { setConsentError(null); setConsentOpen(true); }}>Cookie settings</button>}
  </span>;

  return <AppLayout footerActions={footerActions} hideControls={completionAnimating}>
    {consentState === null ? null
      : consentScreen ? <ConsentScreen busy={consentBusy} error={consentError} onChoose={choice => void chooseConsent(choice)} />
      : <PublicRequestFlow incoming={incoming} requested={requestLink} loading={loading} failed={loadFailed} expired={loadExpired || expired}
        onTransitionChange={setCompletionAnimating} onSave={services.open} onDispose={() => { setIncoming(null); source.current = null; }} />}
  </AppLayout>;
}
