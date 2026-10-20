import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Home } from "./components/Home";
import { RequestIntro } from "./components/RequestIntro";
import { RequestCompletion } from "./components/RequestCompletion";
import { SaveAccessDecision } from "./components/SaveAccessDecision";
import { publicRequestUnsupportedReason, type IncomingRequest } from "./lib/incoming-request";
import { checkExpiry } from "./lib/proof-request";
import type { WalletKit } from "./lib/walletkit";
import { abortable } from "./lib/async";
import { AuthenticatorAccess } from "./components/AuthenticatorAccess";

const SelfieCheck = lazy(() => import("./components/SelfieCheck"));
type Completion = { state: "complete" | "cancelled" | "expired"; returnUrl?: string; offerSave?: boolean };

/** A public visit holds only a temporary capture; wallet management belongs to Dev mode. */
export function PublicRequestFlow({ incoming, requested, loading, failed, expired, onDispose, onSave }: {
  incoming: IncomingRequest | null;
  requested: boolean;
  loading: boolean;
  failed: boolean;
  expired: boolean;
  onDispose: () => void;
  onSave: (signal: AbortSignal, progress: (message: string) => void) => Promise<WalletKit>;
}) {
  const [capturing, setCapturing] = useState(false);
  const [completion, setCompletion] = useState<Completion>();
  const [cancelError, setCancelError] = useState<string>();
  const [saveDecision, setSaveDecision] = useState<{ returnUrl?: string }>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [accessOpen, setAccessOpen] = useState(false);
  const savingController = useRef<AbortController | null>(null);
  const cancelling = useRef<AbortController | null>(null);
  const unsupported = incoming ? publicRequestUnsupportedReason(incoming) : undefined;
  useEffect(() => {
    const stop = () => { cancelling.current?.abort(); savingController.current?.abort(); };
    window.addEventListener("pagehide", stop);
    return () => { stop(); window.removeEventListener("pagehide", stop); };
  }, []);

  const finish = (state: Completion["state"]) => {
    setCapturing(false);
    setCompletion({ state, returnUrl: incoming?.returnUrl });
    onDispose();
  };
  const start = () => {
    if (!incoming || loading || failed || expired || unsupported || completion) return;
    // A suspended tab can click before the expiry timer runs.
    try { checkExpiry(incoming.proof); } catch { finish("expired"); return; }
    setCapturing(true);
  };
  const complete = () => {
    if (incoming) {
      try { checkExpiry(incoming.proof); } catch { finish("expired"); return; }
    }
    // Capture is local only. Do not manufacture a proof response or mark the RP request verified.
    setCapturing(false);
    setCompletion({ state: "complete", returnUrl: incoming?.returnUrl, offerSave: true });
    onDispose();
  };
  const finishDecision = () => {
    setCompletion({ state: "complete", returnUrl: saveDecision?.returnUrl });
    setSaveDecision(undefined);
  };
  const save = async () => {
    if (!saveDecision || savingController.current) return;
    const controller = new AbortController();
    savingController.current = controller;
    setSaving(true); setSaveError(undefined);
    try {
      const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(310_000)]);
      await abortable(onSave(deadline, () => {}).then(wallet => {
        // Also close a wallet returned after cancellation; saving must never open management UI.
        wallet.terminate();
      }), deadline);
      if (!controller.signal.aborted) finishDecision();
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

  if (saveDecision) return <div className="public-request-flow">
    <SaveAccessDecision busy={saving} error={saveError} onSave={() => void save()} onSkip={() => { if (!savingController.current) finishDecision(); }} />
  </div>;

  if (completion) return <div className="public-request-flow">
    <RequestCompletion state={completion.state} returnUrl={completion.returnUrl} detail={cancelError}
      onContinue={completion.offerSave ? () => setSaveDecision({ returnUrl: completion.returnUrl }) : undefined} />
  </div>;

  // Expiry unmounts the camera immediately; no image or camera track survives this state.
  if (capturing && expired) return <div className="public-request-flow">
    <RequestCompletion state="expired" returnUrl={incoming?.returnUrl} />
  </div>;

  if (capturing) return <div className="public-request-flow public-request-flow--capture">
    <Suspense fallback={<p role="status">Opening Selfie Check…</p>}>
      <SelfieCheck onClose={() => void cancel()} backLabel="Cancel check" onComplete={complete} />
    </Suspense>
  </div>;

  if (!requested && !incoming && !failed && !loading) return accessOpen
    ? <AuthenticatorAccess onOpen={onSave} onBack={() => setAccessOpen(false)} />
    : <Home onOpen={() => setAccessOpen(true)} />;

  return <div className="public-request-flow">
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
