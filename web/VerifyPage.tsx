import { useNavigate, useRouter } from "@tanstack/react-router";
import { use, useEffect, useRef, useState } from "react";
import { CompletionAnimationContext } from "./AppShell";
import { DemoContext } from "./DemoPage";
import { isDemoHandoff } from "./lib/demo";
import { loadDemoPreview } from "./lib/demo-preview";
import { DEMO_PATH } from "../config/demo";
import { loadIncomingRequest, type IncomingRequest } from "./lib/incoming-request";
import { RequestExpiredError } from "./lib/proof-request";
import { openAuthenticator, openRequestWallet } from "./lib/wallet-session";
import { PublicRequestFlow } from "./PublicRequestFlow";

const loadRequest: typeof loadIncomingRequest = async (href, signal, progress) =>
  loadDemoPreview(href) ?? loadIncomingRequest(href, signal, progress);

export const defaultServices = { open: openAuthenticator, load: loadRequest, unlock: openRequestWallet };
export type Services = typeof defaultServices;

/** Where request links open: loads and validates the request in the URL, then runs the flow. */
export function VerifyPage({ services }: { services: Services }) {
  const { history } = useRouter();
  const navigate = useNavigate();
  const demo = use(DemoContext);
  const [bridgeId] = useState(() => new URL(window.location.href).searchParams.get("i"));
  const setCompletionAnimating = use(CompletionAnimationContext);
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [loadExpired, setLoadExpired] = useState(false);
  const source = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    source.current ??= window.location.href;
    const url = new URL(source.current);
    // Keep the response capability in memory; remove the bridge key from browser history immediately.
    // Through the router's history so its location state drops the key too.
    if (url.searchParams.has("k")) history.replace(window.location.pathname);
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
  }, [services, history]);

  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, incoming.proof.expires_at * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [incoming]);

  const attempt = demo?.attempt;
  const fromDemo = attempt !== undefined && attempt.bridgeId === bridgeId;
  const mismatch = fromDemo && incoming !== null && !isDemoHandoff(attempt, incoming);
  const demoFlow = fromDemo && demo ? {
    captureOnly: new URL(attempt.returnUrl).protocol === "http:",
    // A verified proof ends here on "You're all set"; a failure shows the demo's result page.
    complete: async (source: Parameters<typeof demo.complete>[0]) => {
      const verified = await demo.complete(source);
      if (!verified) void navigate({ to: DEMO_PATH, replace: true });
      return verified;
    },
    captureComplete: () => {
      demo.captureComplete();
      void navigate({ to: DEMO_PATH, replace: true });
    },
    back: () => { demo.cancel(); void navigate({ to: DEMO_PATH, replace: true }); },
  } : undefined;
  return <PublicRequestFlow incoming={incoming} loading={loading} failed={loadFailed || mismatch} expired={loadExpired || expired}
    demo={demoFlow} onTransitionChange={setCompletionAnimating} onUnlock={services.unlock} onDispose={() => { setIncoming(null); source.current = null; }}
    />;
}
