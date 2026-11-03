import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RequestIntro } from "./components/RequestIntro";
import { RequestCompletion } from "./components/RequestCompletion";
import { SaveAccessDecision } from "./components/SaveAccessDecision";
import { publicRequestUnsupportedReason, type IncomingRequest } from "./lib/incoming-request";
import { checkExpiry } from "./lib/proof-request";
import type { WalletKit } from "./lib/walletkit";
import { abortable } from "./lib/async";
import { captureFrame, requestFrame } from "./components/styles";

const SelfieCheck = lazy(() => import("./components/SelfieCheck"));
type Flow = { stage: "intro" | "capture" | "capture-border" | "capture-complete" | "confirmation" | "confirmation-exit" | "save" | "finished" | "cancelled" | "expired"; returnUrl?: string; saved?: boolean };
const COMPLETION_STEPS = {
  "capture-border": { duration: 300, next: "capture-complete", motion: true },
  "capture-complete": { duration: 500, next: "confirmation", motion: false },
  confirmation: { duration: 1500, next: "confirmation-exit", motion: false },
  "confirmation-exit": { duration: 250, next: "save", motion: true },
} as const;
// Pausing the clock also pauses every animation in the sequence.
const sequence = "group/sequence data-[paused=true]:**:[animation-play-state:paused]";

/** App requests hold a temporary capture; saved authenticator access lives on its own route. */
export function PublicRequestFlow({ incoming, loading, failed, expired, onDispose, onOpenAuthenticator, onSave, onTransitionChange }: {
  incoming: IncomingRequest | null;
  loading: boolean;
  failed: boolean;
  expired: boolean;
  onDispose: () => void;
  onOpenAuthenticator: () => void;
  onTransitionChange: (active: boolean) => void;
  onSave: (signal: AbortSignal, progress: (message: string) => void) => Promise<WalletKit>;
}) {
  const [flow, setFlow] = useState<Flow>({ stage: "intro" });
  const [paused, setPaused] = useState(() => document.hidden);
  const [cancelError, setCancelError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const savingController = useRef<AbortController | null>(null);
  const cancelling = useRef<AbortController | null>(null);
  const unsupported = incoming ? publicRequestUnsupportedReason(incoming) : undefined;
  useEffect(() => {
    const stop = () => { cancelling.current?.abort(); savingController.current?.abort(); };
    window.addEventListener("pagehide", stop);
    return () => { stop(); window.removeEventListener("pagehide", stop); };
  }, []);

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
    setFlow({ stage, returnUrl: incoming?.returnUrl });
    onDispose();
  };
  const start = () => {
    if (!incoming || loading || failed || expired || unsupported || flow.stage !== "intro") return;
    // A suspended tab can click before the expiry timer runs.
    try { checkExpiry(incoming.proof); } catch { finish("expired"); return; }
    setFlow({ stage: "capture" });
  };
  const complete = () => {
    if (incoming) {
      try { checkExpiry(incoming.proof); } catch { finish("expired"); return; }
    }
    // Local capture supplies the completion signal until real enrollment is connected.
    setFlow({ stage: "capture-border", returnUrl: incoming?.returnUrl });
    onDispose();
  };
  const finishDecision = (saved: boolean) => {
    setFlow(current => ({ ...current, stage: "finished", saved }));
  };
  const save = async () => {
    if (flow.stage !== "save" || savingController.current) return;
    const controller = new AbortController();
    savingController.current = controller;
    setSaving(true); setSaveError(undefined);
    try {
      const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(310_000)]);
      await abortable(onSave(deadline, () => {}).then(wallet => {
        // Also close a wallet returned after cancellation; saving must never open management UI.
        wallet.terminate();
      }), deadline);
      if (!controller.signal.aborted) finishDecision(true);
    } catch {
      if (!controller.signal.aborted) setSaveError("Setup didn’t finish. A passkey may already have been saved. Retry with that passkey, or choose Not now to close.");
    } finally {
      if (savingController.current === controller) savingController.current = null;
      if (!controller.signal.aborted) setSaving(false);
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

  if (flow.stage === "save") return <div className={`${requestFrame} motion-safe:animate-completion-in`} data-testid="save-decision">
    <SaveAccessDecision busy={saving} error={saveError} onSave={() => void save()} onSkip={() => { if (!savingController.current) finishDecision(false); }} />
  </div>;

  if (flow.stage === "finished" || flow.stage === "cancelled" || flow.stage === "expired") return <div className={requestFrame}>
    <RequestCompletion state={flow.stage === "finished" ? "complete" : flow.stage} saved={flow.saved} returnUrl={flow.returnUrl} detail={cancelError} onOpen={onOpenAuthenticator} />
  </div>;

  if (flow.stage === "confirmation" || flow.stage === "confirmation-exit") return <div className={`${requestFrame} ${sequence}`} data-stage={flow.stage} data-paused={paused}>
    <RequestCompletion state="complete" transient />
  </div>;

  // Expiry unmounts an unfinished capture. Accepted completion has already disposed the request.
  if (flow.stage === "capture" && expired) return <div className={requestFrame}>
    <RequestCompletion state="expired" returnUrl={incoming?.returnUrl} />
  </div>;

  if (flow.stage === "capture" || flow.stage === "capture-border" || flow.stage === "capture-complete") return <div className={`${captureFrame} ${sequence}`} data-testid="request-frame" data-stage={flow.stage} data-paused={paused}>
    <Suspense fallback={<p role="status">Opening Selfie Check…</p>}>
      <SelfieCheck onClose={() => void cancel()} backLabel="Cancel check" onComplete={complete} />
    </Suspense>
  </div>;

  return <div className={requestFrame}>
    <RequestIntro
      selfieOnly
      state={loading ? "verifying" : expired ? "expired" : failed || !incoming ? "invalid" : unsupported ? "unsupported" : "ready"}
      rp={incoming?.label}
      reason={unsupported}
      returnUrl={incoming?.returnUrl}
      busy={false}
      onStart={start}
      onCancel={() => void cancel()}
    />
  </div>;
}
