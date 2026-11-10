import { lazy, Suspense, use, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RequestIntro } from "./components/RequestIntro";
import { RequestCompletion } from "./components/RequestCompletion";
import { ConsentContinuationContext } from "./AppShell";
import { publicRequestUnsupportedReason, type IncomingRequest } from "./lib/incoming-request";
import { checkExpiry, RequestExpiredError } from "./lib/proof-request";
import { hasSavedWallet, type RequestWalletSession, type WalletOpenMode } from "./lib/wallet-session";
import { walletOpenErrorMessage } from "./lib/wallet-errors";
import { abortable } from "./lib/async";
import { captureFrame, requestFrame } from "./components/styles";

const SelfieCheck = lazy(() => import("./components/SelfieCheck"));
type Flow = { stage: "intro" | "capture" | "preparing" | "setup-error" | "capture-border" | "capture-complete" | "confirmation" | "confirmation-exit" | "finished" | "cancelled" | "expired"; returnUrl?: string };
const COMPLETION_STEPS = {
  "capture-border": { duration: 300, next: "capture-complete", motion: true },
  "capture-complete": { duration: 500, next: "confirmation", motion: false },
  confirmation: { duration: 1500, next: "confirmation-exit", motion: false },
  "confirmation-exit": { duration: 250, next: "finished", motion: true },
} as const;
// Pausing the clock also pauses every animation in the sequence.
const sequence = "group/sequence data-[paused=true]:**:[animation-play-state:paused]";

/** App requests hold a temporary capture; saved authenticator access lives on its own route. */
export function PublicRequestFlow({ incoming, loading, failed, expired, onDispose, onUnlock, onTransitionChange }: {
  incoming: IncomingRequest | null;
  loading: boolean;
  failed: boolean;
  expired: boolean;
  onDispose: () => void;
  onTransitionChange: (active: boolean) => void;
  onUnlock: (signal: AbortSignal, progress: (message: string) => void, mode?: WalletOpenMode) => Promise<RequestWalletSession>;
}) {
  const [flow, setFlow] = useState<Flow>({ stage: "intro" });
  const [paused, setPaused] = useState(() => document.hidden);
  const [cancelError, setCancelError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();
  const [openProgress, setOpenProgress] = useState("Opening authenticator…");
  const continuationRef = use(ConsentContinuationContext);
  const pendingStart = useRef<WalletOpenMode | null>(null);
  const selectedMode = useRef<WalletOpenMode>("either");
  const operation = useRef<AbortController | null>(null);
  const cancelling = useRef<AbortController | null>(null);
  const session = useRef<RequestWalletSession | null>(null);
  const completing = useRef(false);
  const unsupported = incoming ? publicRequestUnsupportedReason(incoming) : undefined;
  const stop = useCallback(() => {
    operation.current?.abort(); operation.current = null;
    session.current?.dispose(); session.current = null;
  }, []);
  useEffect(() => {
    const leave = () => { stop(); cancelling.current?.abort(); };
    window.addEventListener("pagehide", leave);
    return () => { leave(); window.removeEventListener("pagehide", leave); };
  }, [stop]);
  useEffect(() => { if (expired) stop(); }, [expired, stop]);

  const automatic = flow.stage in COMPLETION_STEPS;
  useLayoutEffect(() => {
    onTransitionChange(automatic);
    return () => onTransitionChange(false);
  }, [automatic, onTransitionChange]);

  // One clock owns the sequence. Hidden tabs retain the remaining visible time.
  useEffect(() => {
    if (!(flow.stage in COMPLETION_STEPS)) return;
    const stage = flow.stage as keyof typeof COMPLETION_STEPS;
    const step = COMPLETION_STEPS[stage];
    let remaining: number = step.motion && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : step.duration;
    let started = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const pause = () => {
      if (timer !== undefined) {
        clearTimeout(timer); timer = undefined;
        remaining = Math.max(0, remaining - (performance.now() - started));
      }
    };
    const resume = () => {
      setPaused(document.hidden);
      if (document.hidden || stopped || timer !== undefined) return;
      started = performance.now();
      timer = setTimeout(() => {
        timer = undefined;
        if (document.hidden || stopped) return;
        setFlow(current => current.stage === stage ? { ...current, stage: step.next } : current);
      }, remaining);
    };
    const visibility = () => { if (document.hidden) pause(); resume(); };
    const leave = () => { stopped = true; pause(); setPaused(true); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    resume();
    return () => {
      stopped = true; pause();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
    };
  }, [flow.stage]);

  const finish = (stage: "cancelled" | "expired") => {
    stop();
    setFlow({ stage, returnUrl: incoming?.returnUrl });
    onDispose();
  };
  const start = useCallback(async (mode: WalletOpenMode = selectedMode.current) => {
    if (loading) { pendingStart.current = mode; return; }
    pendingStart.current = null;
    if (!incoming || failed || expired || unsupported || flow.stage !== "intro" || operation.current) return;
    selectedMode.current = mode;
    try { checkExpiry(incoming.proof); }
    catch { setFlow({ stage: "expired", returnUrl: incoming.returnUrl }); onDispose(); return; }
    const controller = new AbortController();
    operation.current = controller;
    const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(310_000)]);
    setOpening(true); setOpenError(undefined); setOpenProgress("Opening authenticator…");
    try {
      const current = await abortable(onUnlock(deadline, message => {
        if (!deadline.aborted) setOpenProgress(message);
      }, mode).then(value => {
        if (deadline.aborted) { value.dispose(); deadline.throwIfAborted(); }
        session.current = value; return value;
      }), deadline);
      deadline.throwIfAborted();
      checkExpiry(incoming.proof);
      setFlow({ stage: "capture" });
      void current.ready.then(result => {
        if (deadline.aborted || session.current !== current || !("error" in result)) return;
        stop();
        setOpenError(walletOpenErrorMessage(result.error));
        setFlow({ stage: "setup-error", returnUrl: incoming.returnUrl });
      });
    } catch (cause) {
      if (!controller.signal.aborted) {
        stop();
        if (cause instanceof RequestExpiredError) {
          setFlow({ stage: "expired", returnUrl: incoming.returnUrl }); onDispose();
        } else setOpenError(walletOpenErrorMessage(cause));
      }
    } finally { setOpening(false); }
  }, [loading, incoming, failed, expired, unsupported, flow.stage, onUnlock, onDispose, stop]);

  useEffect(() => {
    if (!continuationRef) return;
    const proceed = () => { void start(); };
    continuationRef.current = proceed;
    return () => { if (continuationRef.current === proceed) continuationRef.current = null; };
  }, [continuationRef, start]);
  useEffect(() => {
    if (pendingStart.current === null || loading) return;
    const mode = pendingStart.current;
    const timer = setTimeout(() => void start(mode), 0);
    return () => clearTimeout(timer);
  }, [loading, start]);

  const complete = async () => {
    const current = session.current;
    if (!current || completing.current) return;
    completing.current = true;
    try {
      if (incoming) checkExpiry(incoming.proof);
      setFlow({ stage: "preparing", returnUrl: incoming?.returnUrl });
      const result = await current.ready;
      if (session.current !== current) return;
      if ("error" in result) throw result.error;
      if (incoming) checkExpiry(incoming.proof);
      stop();
      // Real attested enrollment and proof delivery are connected separately.
      setFlow({ stage: "capture-border", returnUrl: incoming?.returnUrl });
      onDispose();
    } catch (cause) {
      if (session.current !== current) return;
      stop();
      if (cause instanceof RequestExpiredError) { finish("expired"); return; }
      setOpenError(walletOpenErrorMessage(cause));
      setFlow({ stage: "setup-error", returnUrl: incoming?.returnUrl });
    }
  };
  const cancel = async () => {
    if (cancelling.current) return;
    const request = incoming;
    finish("cancelled");
    if (!request) return;
    const controller = new AbortController();
    cancelling.current = controller;
    try {
      await request.cancel(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
    } catch {
      if (!controller.signal.aborted) setCancelError("Your check was closed, but the requesting app could not be notified. Return there to start again.");
    } finally {
      if (cancelling.current === controller) cancelling.current = null;
    }
  };

  if (flow.stage === "setup-error") return <div className={requestFrame}>
    <RequestCompletion state="error" detail={openError} returnUrl={flow.returnUrl} onRetry={() => {
      completing.current = false; setOpenError(undefined); setFlow({ stage: "intro" });
    }} />
  </div>;

  if (flow.stage === "finished" || flow.stage === "cancelled" || flow.stage === "expired") return <div className={requestFrame}>
    <RequestCompletion state={flow.stage === "finished" ? "complete" : flow.stage} returnUrl={flow.returnUrl} detail={cancelError} />
  </div>;

  if (flow.stage === "confirmation" || flow.stage === "confirmation-exit") return <div className={`${requestFrame} ${sequence}`} data-stage={flow.stage} data-paused={paused}>
    <RequestCompletion state="complete" transient />
  </div>;

  // Expiry unmounts an unfinished capture. Accepted completion has already disposed the request.
  if ((flow.stage === "capture" || flow.stage === "preparing") && expired) return <div className={requestFrame}>
    <RequestCompletion state="expired" returnUrl={incoming?.returnUrl} />
  </div>;

  if (flow.stage === "capture" || flow.stage === "preparing" || flow.stage === "capture-border" || flow.stage === "capture-complete") return <div className={`${captureFrame} ${sequence}`} data-testid="request-frame" data-stage={flow.stage} data-paused={paused}>
    <Suspense fallback={<p role="status">Opening Selfie Check…</p>}>
      <SelfieCheck onClose={() => void cancel()} backLabel="Cancel check" onComplete={() => void complete()} completionHint={flow.stage === "preparing" ? openProgress : undefined} />
    </Suspense>
  </div>;

  return <div className={requestFrame}>
    <RequestIntro
      selfieOnly
      state={loading ? "verifying" : expired ? "expired" : failed || !incoming ? "invalid" : unsupported ? "unsupported" : "ready"}
      rp={incoming?.label}
      reason={unsupported}
      returnUrl={incoming?.returnUrl}
      busy={opening}
      busyMessage={openProgress}
      detail={openError}
      onStart={() => void start()}
      onOpenExisting={!hasSavedWallet() ? () => void start("open") : undefined}
      onCancel={() => void cancel()}
    />
  </div>;
}
