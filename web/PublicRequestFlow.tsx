import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { RequestIntro } from "./components/RequestIntro";
import { RequestCompletion } from "./components/RequestCompletion";
import { ProcessingStatus, type EndAction } from "./components/ProcessingGlyph";
import { checkRequestCredentials, publicRequestUnsupportedReason, type IncomingRequest } from "./lib/incoming-request";
import { checkExpiry, RequestExpiredError } from "./lib/proof-request";
import type { RequestWalletSession } from "./lib/wallet-session";
import { WalletTakenOverError, walletOpenErrorMessage } from "./lib/wallet-errors";
import type { WalletKit } from "./lib/walletkit";
import { abortable, onAbort } from "./lib/async";
import { createPoseGuardEnrollment, holdingBusy, selfieIssuer, type RunPoseGuard } from "./lib/poseguard/enrollment";
import { ProofReplayedError, proveAndDeliver } from "./lib/prove";
import { actions, body, captureFrame, centeredLayout, consentFrame, requestFrame, screenContent, secondaryAction } from "./components/styles";

const SelfieCheck = lazy(() => import("./components/SelfieCheck"));
// Shown once a credential is in the wallet, while the proof is created and sent.
const PROVING = { title: "Credential received", hint: "Generating proof" };
const APP_NOT_NOTIFIED = "The requesting app could not be notified. Return there to start again.";

type Flow =
  | { stage: "intro" | "proving" | "all-set" | "cancelled" | "expired" | "replayed" | "unavailable" | "handed-off" }
  | { stage: "capture"; enroll: RunPoseGuard }
  | { stage: "error"; detail: string };

/**
 * Answers an app's request: proves from a credential the wallet holds, or enrolls a Selfie Check
 * with the environment's issuer first. A request neither can satisfy is declined.
 */
export function PublicRequestFlow({ incoming, loading, failed, expired, onDispose, onUnlock }: {
  incoming: IncomingRequest | null;
  loading: boolean;
  failed: boolean;
  expired: boolean;
  onDispose: () => void;
  onUnlock: (signal: AbortSignal, progress: (message: string) => void) => Promise<RequestWalletSession>;
}) {
  const [flow, setFlow] = useState<Flow>({ stage: "intro" });
  // Kept once the request is acted on: end screens link back to the app after it is disposed.
  const [keptReturnUrl, setReturnUrl] = useState<string>();
  const returnUrl = incoming?.returnUrl ?? keptReturnUrl;
  const [notice, setNotice] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [openProgress, setOpenProgress] = useState("Opening authenticator…");
  const operation = useRef<AbortController | null>(null);
  const declining = useRef<AbortController | null>(null);
  const session = useRef<RequestWalletSession | null>(null);
  const unsupported = incoming ? publicRequestUnsupportedReason(incoming) : undefined;

  const stop = useCallback(() => {
    operation.current?.abort(new DOMException("The request flow stopped.", "AbortError")); operation.current = null;
    session.current?.dispose(); session.current = null;
  }, []);
  useEffect(() => {
    const leave = () => { stop(); declining.current?.abort(); };
    window.addEventListener("pagehide", leave);
    return () => { leave(); window.removeEventListener("pagehide", leave); };
  }, [stop]);
  useEffect(() => { if (expired) stop(); }, [expired, stop]);

  /**
   * Ends the request on a final screen. A request handed off to another tab sends the app
   * nothing: that tab may be answering this same request.
   */
  const end = useCallback((stage: "all-set" | "cancelled" | "expired" | "replayed" | "unavailable" | "handed-off") => {
    stop();
    setFlow({ stage });
    onDispose();
  }, [onDispose, stop]);

  /** Ends the request and tells the app it will get no proof, so it stops waiting. */
  const decline = useCallback(async (request: IncomingRequest, stage: "cancelled" | "unavailable") => {
    if (declining.current) return;
    const controller = new AbortController();
    declining.current = controller;
    setReturnUrl(request.returnUrl);
    end(stage);
    try {
      await request.cancel(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
    } catch {
      if (!controller.signal.aborted) setNotice(APP_NOT_NOTIFIED);
    } finally {
      if (declining.current === controller) declining.current = null;
    }
  }, [end]);

  /** Proves and delivers. Resolves false when this action was proved before. */
  const answer = useCallback(async (request: IncomingRequest, wallet: WalletKit, signal: AbortSignal): Promise<boolean> => {
    try {
      await proveAndDeliver(request, wallet, signal);
      return true;
    } catch (cause) {
      if (!(cause instanceof ProofReplayedError)) throw cause;
      end("replayed");
      return false;
    }
  }, [end]);

  const start = useCallback(async () => {
    // The request screen's Continue tap is the gesture that opens the passkey.
    if (loading || !incoming || failed || expired || unsupported || flow.stage !== "intro" || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(310_000)]);
    setReturnUrl(incoming.returnUrl);
    setOpening(true); setOpenProgress("Opening authenticator…");
    try {
      checkExpiry(incoming.proof);
      const current = await abortable(onUnlock(deadline, message => {
        if (!deadline.aborted) setOpenProgress(message);
      }).then(value => {
        if (deadline.aborted) { value.dispose(); deadline.throwIfAborted(); }
        // Another tab took the wallet and has already stopped its worker here.
        session.current = value;
        onAbort(value.takenOver, () => { if (session.current === value) end("handed-off"); });
        return value;
      }), deadline);
      const ready = await abortable(current.ready, deadline);
      if ("error" in ready) throw ready.error;
      const credentials = await checkRequestCredentials(incoming, ready.wallet, deadline);
      checkExpiry(incoming.proof);

      if (credentials.satisfied) {
        setFlow({ stage: "proving" });
        const release = await current.holdBusy();
        try {
          if (await answer(incoming, ready.wallet, deadline)) end("all-set");
        } finally { release(); }
        return;
      }
      const issuer = selfieIssuer();
      if (!issuer || !credentials.canEnrollSelfie) {
        void decline(incoming, "unavailable");
        return;
      }
      const enroll = createPoseGuardEnrollment(ready.wallet, issuer, controller.signal);
      // A tab that opens later is refused while a capture, issuance or proof runs here, and
      // while a submitted capture is unresolved: only this tab can recover its credential.
      setFlow({ stage: "capture", enroll: holdingBusy(enroll, () => current.holdBusy(), async (signal, update) => {
        update({ phase: "checking", ...PROVING, progress: 1, cameraReady: false });
        // A replayed action replaces the capture screen, so its outcome is never shown.
        if (await answer(incoming, ready.wallet, AbortSignal.any([signal, controller.signal]))) { stop(); onDispose(); }
      }) });
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof RequestExpiredError) end("expired");
      else if (cause instanceof WalletTakenOverError) end("handed-off");
      else { stop(); setFlow({ stage: "error", detail: walletOpenErrorMessage(cause) }); }
    } finally { setOpening(false); }
  }, [loading, incoming, failed, expired, unsupported, flow.stage, onUnlock, onDispose, stop, end, answer, decline]);

  const cancel = () => { if (incoming) void decline(incoming, "cancelled"); else end("cancelled"); };
  const endAction: EndAction | undefined = returnUrl ? { label: "Return to the app", href: returnUrl } : undefined;

  if (flow.stage === "proving" || flow.stage === "all-set") return <section className="fixed inset-0 z-40 m-auto flex h-[100svh] w-full max-w-[393px] flex-col items-center justify-center bg-white px-6 text-center" aria-label="Selfie check">
    <ProcessingStatus title={PROVING.hint} done={flow.stage === "all-set"} endAction={endAction} />
  </section>;

  if (opening) return <div className={requestFrame}>
    <div className={screenContent}><div className={centeredLayout}>
      <p className={body} role="status">{openProgress}</p>
    </div></div>
    <div className={actions}><button className={secondaryAction} onClick={cancel}>Cancel request</button></div>
  </div>;

  if (flow.stage === "error") return <div className={requestFrame}>
    <RequestCompletion state="error" detail={flow.detail} returnUrl={returnUrl} onRetry={() => setFlow({ stage: "intro" })} />
  </div>;

  // Expiry unmounts an unfinished capture.
  if (flow.stage === "capture" && expired) return <div className={requestFrame}>
    <RequestCompletion state="expired" returnUrl={returnUrl} />
  </div>;

  if (flow.stage === "capture") return <div className={captureFrame} data-testid="request-frame">
    <Suspense fallback={<p role="status">Opening Selfie Check…</p>}>
      <SelfieCheck onClose={cancel} backLabel="Cancel check" enroll={flow.enroll} endAction={endAction} />
    </Suspense>
  </div>;

  if (flow.stage !== "intro") return <div className={requestFrame}>
    <RequestCompletion state={flow.stage} returnUrl={flow.stage === "handed-off" ? undefined : returnUrl} detail={notice} />
  </div>;

  return <div className={consentFrame}>
    <RequestIntro
      state={loading ? "verifying" : expired ? "expired" : failed || !incoming ? "invalid" : unsupported ? "unsupported" : "ready"}
      rp={incoming?.label}
      reason={unsupported}
      returnUrl={incoming?.returnUrl}
      onStart={() => void start()}
      onCancel={cancel}
    />
  </div>;
}
