import { lazy, Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiagnosticOutcome, DiagnosticStage } from "../config/selfie-check-debug-report";
import { SelfieCheckDiagnosticsContext } from "./AppShell";
import { RequestIntro } from "./components/RequestIntro";
import { RequestCompletion } from "./components/RequestCompletion";
import { checkRequestCredentials, publicRequestUnsupportedReason, type IncomingRequest } from "./lib/incoming-request";
import { checkExpiry, RequestExpiredError } from "./lib/proof-request";
import type { RequestWalletSession } from "./lib/wallet-session";
import { WalletOpenError, walletOpenErrorMessage } from "./lib/wallet-errors";
import type { WalletKit } from "./lib/walletkit";
import type { DemoProofSource } from "./lib/demo";
import { abortable } from "./lib/async";
import { configureDemoEnrollment } from "./lib/demo-enrollment";
import { configuredPoseGuardSignup, createPoseGuardEnrollment, type RunPoseGuard } from "./lib/poseguard/enrollment";
import type { SelfieCheckDiagnosticAttempt } from "./lib/selfie-check-debug-report";
import { actions, body, captureFrame, centeredLayout, consentFrame, requestFrame, screenContent, secondaryAction } from "./components/styles";

const SelfieCheck = lazy(() => import("./components/SelfieCheck"));
// The second of two loading messages; enrollment shows "Processing liveness" before it.
const GENERATING_PROOF = "Credential received - generating proof";
const REQUEST_EXPIRED = { type: "expired", reason: "request_expired" } as const;
type Flow = { stage: "intro" | "capture" | "preparing" | "setup-error" | "capture-border" | "capture-complete" | "confirmation" | "confirmation-exit" | "finished" | "cancelled" | "expired" | "replayed"; returnUrl?: string; enroll?: RunPoseGuard };
const COMPLETION_STEPS = {
  "capture-border": { duration: 300, next: "capture-complete", motion: true },
  "capture-complete": { duration: 500, next: "confirmation", motion: false },
  confirmation: { duration: 1500, next: "confirmation-exit", motion: false },
  "confirmation-exit": { duration: 250, next: "finished", motion: true },
} as const;
// Pausing the clock also pauses every animation in the sequence.
const sequence = "group/sequence data-[paused=true]:**:[animation-play-state:paused]";

/** App requests hold a temporary capture; saved authenticator access lives on its own route. */
export function PublicRequestFlow({ incoming, loading, failed, expired, onDispose, onUnlock, onTransitionChange, demo }: {
  incoming: IncomingRequest | null;
  loading: boolean;
  failed: boolean;
  expired: boolean;
  onDispose: () => void;
  demo?: {
    captureOnly: boolean;
    complete: (source: DemoProofSource, diagnostic?: SelfieCheckDiagnosticAttempt) => void;
    captureComplete: () => void;
    back: () => void;
  };
  onTransitionChange: (active: boolean) => void;
  onUnlock: (signal: AbortSignal, progress: (message: string) => void) => Promise<RequestWalletSession>;
}) {
  const [flow, setFlow] = useState<Flow>({ stage: "intro" });
  const [paused, setPaused] = useState(() => document.hidden);
  const [cancelError, setCancelError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();
  const [openProgress, setOpenProgress] = useState("Opening authenticator…");
  const operation = useRef<AbortController | null>(null);
  const cancelling = useRef<AbortController | null>(null);
  const session = useRef<RequestWalletSession | null>(null);
  const completing = useRef(false);
  const unsupported = incoming ? publicRequestUnsupportedReason(incoming) : undefined;
  const diagnostics = use(SelfieCheckDiagnosticsContext);
  const activeDiagnostic = useRef<SelfieCheckDiagnosticAttempt | undefined>(undefined);
  const startReport = useMemo(() => incoming ? diagnostics?.forRequest(incoming.environment) : undefined, [diagnostics, incoming]);
  const beginDiagnosticAttempt = useCallback((stage: DiagnosticStage) => {
    activeDiagnostic.current = startReport?.(stage);
    return activeDiagnostic.current;
  }, [startReport]);
  const beginCaptureDiagnostic = useCallback(() => {
    const active = activeDiagnostic.current;
    if (!active || active.finished) return beginDiagnosticAttempt("capture");
    active.enter("capture");
    return active;
  }, [beginDiagnosticAttempt]);
  const finishDiagnostic = useCallback((outcome: DiagnosticOutcome) => {
    if (!incoming || failed || unsupported) return;
    (activeDiagnostic.current ?? beginDiagnosticAttempt("request"))?.finish(outcome);
  }, [beginDiagnosticAttempt, failed, incoming, unsupported]);

  const stop = useCallback(() => {
    operation.current?.abort(new DOMException("The request flow stopped.", "AbortError")); operation.current = null;
    session.current?.dispose(); session.current = null;
  }, []);
  useEffect(() => {
    const cleanup = () => { activeDiagnostic.current?.finish(); stop(); cancelling.current?.abort(); };
    const leave = () => {
      activeDiagnostic.current?.finish({ type: "interrupted", reason: "page_left" });
      cleanup();
    };
    window.addEventListener("pagehide", leave);
    return () => { cleanup(); window.removeEventListener("pagehide", leave); };
  }, [stop]);
  useEffect(() => {
    if (!expired) return;
    finishDiagnostic(REQUEST_EXPIRED);
    stop();
  }, [expired, finishDiagnostic, stop]);

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
  const completeDemo = useCallback(async (
    request: IncomingRequest, wallet: WalletKit, signal: AbortSignal, source: DemoProofSource, diagnostic?: SelfieCheckDiagnosticAttempt,
  ) => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
    checkExpiry(request.proof);
    let proof: string;
    diagnostic?.enter("proof_generate");
    try {
      proof = await abortable(wallet.generateProof(JSON.stringify(request.proof)), deadline);
    } catch (error) {
      if (deadline.aborted) diagnostic?.fail(deadline.reason);
      deadline.throwIfAborted();
      if (error instanceof Error && error.name === "WalletKitError" && "code" in error && error.code === "NullifierReplay") {
        diagnostic?.finish({ type: "rejected", reason: "nullifier_replay" });
        stop();
        setFlow({ stage: "replayed", returnUrl: request.returnUrl });
        onDispose();
        return;
      }
      diagnostic?.fail(error);
      throw new WalletOpenError("Could not create the proof. Try again.");
    }
    diagnostic?.enter("proof_validate");
    try {
      await request.deliver(proof, deadline, diagnostic);
    } catch (error) {
      diagnostic?.fail(deadline.aborted ? deadline.reason : error);
      deadline.throwIfAborted();
      throw new WalletOpenError("Could not send the proof. Try again.");
    }
    deadline.throwIfAborted();
    stop();
    activeDiagnostic.current = undefined;
    onDispose();
    demo?.complete(source, diagnostic);
  }, [demo, onDispose, stop]);

  const start = useCallback(async () => {
    // The request screen's Continue tap is the gesture that opens the passkey.
    if (loading || !incoming || failed || expired || unsupported || flow.stage !== "intro" || operation.current) return;
    try { checkExpiry(incoming.proof); }
    catch {
      finishDiagnostic(REQUEST_EXPIRED);
      setFlow({ stage: "expired", returnUrl: incoming.returnUrl }); onDispose(); return;
    }
    const controller = new AbortController();
    operation.current = controller;
    const diagnostic = beginDiagnosticAttempt("passkey");
    const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(310_000)]);
    setOpening(true); setOpenError(undefined); setOpenProgress("Opening authenticator…");
    try {
      const current = await abortable(onUnlock(deadline, message => {
        if (!deadline.aborted) setOpenProgress(message);
      }).then(value => {
        if (deadline.aborted) { value.dispose(); deadline.throwIfAborted(); }
        session.current = value; return value;
      }), deadline);
      deadline.throwIfAborted();
      checkExpiry(incoming.proof);
      if (demo) {
        diagnostic?.enter("wallet_ready");
        const ready = await abortable(current.ready, deadline);
        if ("error" in ready) throw ready.error;
        if (!demo.captureOnly) {
          const credentials = await checkRequestCredentials(incoming, ready.wallet, deadline);
          checkExpiry(incoming.proof);
          if (credentials.satisfied) {
            setOpenProgress(GENERATING_PROOF);
            await completeDemo(incoming, ready.wallet, deadline, "saved", diagnostic);
            return;
          }
          if (!credentials.canEnrollSelfie) {
            throw new WalletOpenError("This authenticator can’t complete this Selfie Check.");
          }
        }
        const enroll = configureDemoEnrollment(current, controller.signal);
        setFlow({ stage: "capture", enroll: async (video, signal, update, captureDiagnostic) => {
          const result = await enroll(video, signal, update, captureDiagnostic);
          if (result === "captured") {
            checkExpiry(incoming.proof);
            captureDiagnostic?.finish();
            stop();
            onDispose();
            demo.captureComplete();
          } else if (result === "completed") {
            update({ phase: "checking", title: GENERATING_PROOF, hint: "", progress: 1, cameraReady: false });
            await completeDemo(incoming, ready.wallet, AbortSignal.any([signal, controller.signal]), "issued", captureDiagnostic);
          }
          return result;
        } });
        return;
      }
      const signup = configuredPoseGuardSignup();
      const enroll = signup && createPoseGuardEnrollment(current, signup, controller.signal);
      setFlow({ stage: "capture", enroll: enroll ? async (video, signal, update, captureDiagnostic) => {
        const outcome = await enroll(video, signal, update, captureDiagnostic);
        if (outcome === "completed") captureDiagnostic?.finish();
        return outcome;
      } : undefined });
      void current.ready.then(result => {
        if (deadline.aborted || session.current !== current || !("error" in result)) return;
        activeDiagnostic.current?.enter("wallet_ready");
        activeDiagnostic.current?.fail(result.error);
        stop();
        setOpenError(walletOpenErrorMessage(result.error));
        setFlow({ stage: "setup-error", returnUrl: incoming.returnUrl });
      });
    } catch (cause) {
      if (!controller.signal.aborted) {
        diagnostic?.fail(cause);
        stop();
        if (cause instanceof RequestExpiredError) {
          setFlow({ stage: "expired", returnUrl: incoming.returnUrl }); onDispose();
        } else {
          setOpenError(walletOpenErrorMessage(cause));
          setFlow({ stage: "setup-error", returnUrl: incoming.returnUrl });
        }
      }
    } finally { setOpening(false); }
  }, [loading, incoming, failed, expired, unsupported, flow.stage, onUnlock, onDispose, stop, demo, completeDemo, beginDiagnosticAttempt, finishDiagnostic]);

  const complete = async () => {
    const current = session.current;
    if (!current || completing.current) return;
    completing.current = true;
    try {
      if (incoming) checkExpiry(incoming.proof);
      setFlow({ stage: "preparing", returnUrl: incoming?.returnUrl });
      activeDiagnostic.current?.enter("wallet_ready");
      const result = await current.ready;
      if (session.current !== current) return;
      if ("error" in result) throw result.error;
      if (incoming) checkExpiry(incoming.proof);
      activeDiagnostic.current?.finish();
      stop();
      // Real attested enrollment and proof delivery are connected separately.
      setFlow({ stage: "capture-border", returnUrl: incoming?.returnUrl });
      onDispose();
    } catch (cause) {
      if (session.current !== current) return;
      activeDiagnostic.current?.fail(cause);
      stop();
      if (cause instanceof RequestExpiredError) { finish("expired"); return; }
      setOpenError(walletOpenErrorMessage(cause));
      setFlow({ stage: "setup-error", returnUrl: incoming?.returnUrl });
    }
  };
  const cancel = async () => {
    if (cancelling.current) return;
    const request = incoming;
    finishDiagnostic({ type: "cancelled", reason: "user_cancelled" });
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

  if (opening) return <div className={requestFrame}>
    <div className={screenContent}><div className={centeredLayout}>
      <p className={body} role="status">{openProgress}</p>
    </div></div>
    <div className={actions}><button className={secondaryAction} onClick={() => void cancel()}>Cancel request</button></div>
  </div>;

  if (flow.stage === "setup-error") return <div className={requestFrame}>
    <RequestCompletion state="error" detail={openError} returnUrl={flow.returnUrl} onReturn={demo?.back} onRetry={() => {
      completing.current = false; setOpenError(undefined); setFlow({ stage: "intro" });
    }} />
  </div>;

  if (flow.stage === "finished" || flow.stage === "cancelled" || flow.stage === "expired" || flow.stage === "replayed") return <div className={requestFrame}>
    <RequestCompletion state={flow.stage === "finished" ? "complete" : flow.stage} returnUrl={flow.returnUrl} detail={cancelError} onReturn={demo?.back} />
  </div>;

  if (flow.stage === "confirmation" || flow.stage === "confirmation-exit") return <div className={`${requestFrame} ${sequence}`} data-stage={flow.stage} data-paused={paused}>
    <RequestCompletion state="complete" transient />
  </div>;

  // Expiry unmounts an unfinished capture. Accepted completion has already disposed the request.
  if ((flow.stage === "capture" || flow.stage === "preparing") && expired) return <div className={requestFrame}>
    <RequestCompletion state="expired" returnUrl={incoming?.returnUrl} onReturn={demo?.back} />
  </div>;

  if (flow.stage === "capture" || flow.stage === "preparing" || flow.stage === "capture-border" || flow.stage === "capture-complete") return <div className={`${captureFrame} ${sequence}`} data-testid="request-frame" data-stage={flow.stage} data-paused={paused}>
    <Suspense fallback={<p role="status">Opening Selfie Check…</p>}>
      <SelfieCheck
        onClose={() => void cancel()}
        backLabel="Cancel check"
        onComplete={flow.enroll ? undefined : () => void complete()}
        beginDiagnosticAttempt={beginCaptureDiagnostic}
        enroll={flow.enroll}
        completionHint={flow.stage === "preparing" ? openProgress : undefined}
      />
    </Suspense>
  </div>;

  return <div className={consentFrame}>
    <RequestIntro
      onReturn={demo?.back}
      state={loading ? "verifying" : expired ? "expired" : failed || !incoming ? "invalid" : unsupported ? "unsupported" : "ready"}
      rp={demo && incoming ? "Web Authenticator" : incoming?.label}
      reason={unsupported}
      returnUrl={incoming?.returnUrl}
      onStart={() => void start()}
      onCancel={() => void cancel()}
    />
  </div>;
}
