import { useNavigate, useRouter } from "@tanstack/react-router";
import { use, useEffect, useRef, useState } from "react";
import { AnalyticsConsentContext, CompletionAnimationContext } from "./AppShell";
import { analytics } from "./lib/analytics";
import { publicRequestUnsupportedReason } from "./lib/incoming-request";
import { loadIncomingRequest, type IncomingRequest } from "./lib/incoming-request";
import { RequestExpiredError } from "./lib/proof-request";
import { openAuthenticator } from "./lib/wallet-session";
import { PublicRequestFlow } from "./PublicRequestFlow";

export const defaultServices = { open: openAuthenticator, load: loadIncomingRequest };
export type Services = typeof defaultServices;

/** Where request links open: loads and validates the request in the URL, then runs the flow. */
export function VerifyPage({ services }: { services: Services }) {
  const { history } = useRouter();
  const navigate = useNavigate();
  const setCompletionAnimating = use(CompletionAnimationContext);
  const consent = use(AnalyticsConsentContext);
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [loadExpired, setLoadExpired] = useState(false);
  const source = useRef<string | null>(null);
  const hadIncoming = useRef(false);

  useEffect(() => {
    analytics.startFlow();
    const controller = new AbortController();
    source.current ??= window.location.href;
    const url = new URL(source.current);
    // Keep the response capability in memory; remove the bridge key from browser history immediately.
    // Through the router's history so its location state drops the key too.
    if (url.searchParams.has("k")) history.replace(window.location.pathname);
    void services.load(source.current, controller.signal, () => {}).then(request => {
      if (!controller.signal.aborted) { hadIncoming.current = request !== null; source.current = null; setIncoming(request); setLoading(false); }
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
  }, [services, history]);

  useEffect(() => {
    if (consent !== "granted" || loading) return;
    // Disposal after local capture must not turn a valid request into a failure.
    if (!incoming && hadIncoming.current) return;
    if (loadExpired || expired) analytics.once("request", "failed", "expired");
    else if (loadFailed || !incoming) analytics.once("request", "failed", "invalid_data");
    else if (publicRequestUnsupportedReason(incoming)) analytics.once("request", "failed", "unsupported");
    else analytics.once("request", "started");
  }, [consent, loading, loadExpired, expired, loadFailed, incoming]);

  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, incoming.proof.expires_at * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [incoming]);

  return <PublicRequestFlow incoming={incoming} loading={loading} failed={loadFailed} expired={loadExpired || expired}
    onTransitionChange={setCompletionAnimating} onSave={services.open} onDispose={() => { setIncoming(null); source.current = null; }}
    // Replace: the request is spent, so going back to this URL would only show an invalid request.
    onOpenAuthenticator={() => void navigate({ to: "/authenticator", replace: true })} />;
}
