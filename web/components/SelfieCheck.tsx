import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CAPTURE_TIMEOUT_MS, captureFailure, captureSelfie, enrollmentFailure, ENROLLMENT_STATE, INITIAL_CAPTURE_STATE } from "../lib/selfie-capture";
import "./SelfieCheck.css";
import { CaptureProgressRing } from "./CaptureProgressRing";
import { capturePoseGuard, PoseGuardRejected, type PoseCaptureState } from "../lib/poseguard-capture";
import "./PoseGuard.css";
import RequestProcessing from "./RequestProcessing";
import type { SelfieProcessingStep } from "../lib/temporary-selfie-session";

/**
 * Captures one frame. Completion waits for the supplied enrollment/request pipeline.
 */
export default function SelfieCheck({ onClose, onComplete, prepare, enroll, backLabel, diagnostics = false, poseguard = false }: {
  onClose: () => void;
  onComplete?: () => void;
  prepare?: (signal: AbortSignal) => Promise<void>;
  enroll?: (image: Blob, signal: AbortSignal, onProgress: (step: SelfieProcessingStep) => void) => Promise<unknown>;
  backLabel: string;
  diagnostics?: boolean;
  poseguard?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  const completion = useRef(onComplete);
  const enrollment = useRef(enroll);
  const preparation = useRef(prepare);
  const publicCompleted = useRef(false);
  const imageUrl = useRef<string | undefined>(undefined);
  useEffect(() => { completion.current = onComplete; }, [onComplete]);
  useEffect(() => { enrollment.current = enroll; }, [enroll]);
  useEffect(() => { preparation.current = prepare; }, [prepare]);
  const [state, setState] = useState<PoseCaptureState>(INITIAL_CAPTURE_STATE);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [image, setImage] = useState<string>();
  const [timing, setTiming] = useState("");
  const [processingStep, setProcessingStep] = useState<SelfieProcessingStep | null>(null);

  const clearImage = () => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = undefined;
  };
  const restart = () => {
    controller.current?.abort();
    clearImage(); setImage(undefined); setTiming(""); setProcessingStep(null);
    setState(INITIAL_CAPTURE_STATE); setAttempt(value => value + 1);
  };
  const close = () => { controller.current?.abort(); onClose(); };

  useEffect(() => {
    const pause = () => {
      controller.current?.abort();
      setVisible(false); setImage(undefined); setTiming(""); setProcessingStep(null);
      setState({ phase: "paused", title: "Your camera is off", hint: "Return to this page to start fresh.", progress: 0, cameraReady: false });
    };
    const visibility = () => {
      if (publicCompleted.current) {
        if (document.hidden) {
          // Stop the live camera in the background; retain only the already-captured frame for the paused completion.
          controller.current?.abort();
          setImage(imageUrl.current);
          setState(current => ({ ...current, cameraReady: false }));
        }
        return;
      }
      if (document.hidden) pause();
      else { setState(INITIAL_CAPTURE_STATE); setVisible(true); setAttempt(value => value + 1); }
    };
    const leave = () => { clearImage(); pause(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  useEffect(() => {
    if (!visible || !video.current) return;
    const active = new AbortController();
    controller.current = active;
    const timeout = new AbortController();
    const deadline = setTimeout(() => timeout.abort(new DOMException("Capture timed out", "TimeoutError")), poseguard ? 120_000 : CAPTURE_TIMEOUT_MS);
    const signal = AbortSignal.any([active.signal, timeout.signal]);
    let enrolling = false;
    let preparing = false;
    const capture = poseguard ? capturePoseGuard : captureSelfie;
    void capture(video.current, signal, next => {
      if (!signal.aborted) setState(next);
    }, {
      retainPreviewUntilAbort: !!completion.current && !enrollment.current,
      beforeCapture: preparation.current ? async captureSignal => {
        preparing = true;
        await preparation.current?.(captureSignal);
        preparing = false;
      } : undefined,
    }).then(async result => {
      if (signal.aborted) return;
      clearTimeout(deadline);
      if (enrollment.current) {
        // Hiding or leaving the page aborts `active`, which also stops the enclave request.
        enrolling = true;
        setState(ENROLLMENT_STATE);
        setProcessingStep("checking-selfie");
        await enrollment.current(result.image, active.signal, step => {
          if (!active.signal.aborted) setProcessingStep(step);
        });
        if (active.signal.aborted) return;
        if (completion.current) {
          completion.current();
          return;
        }
      }
      imageUrl.current = URL.createObjectURL(result.image);
      if (!completion.current) setImage(imageUrl.current);
      setProcessingStep(null);
      publicCompleted.current = !!completion.current;
      setTiming(JSON.stringify(result.timing, null, 2));
      setState({ phase: "complete", title: poseguard ? "Movement check complete" : publicCompleted.current ? "Selfie completed" : "Selfie captured", hint: publicCompleted.current ? "" : poseguard ? "You followed all four movements. This demo was checked on your device." : "Saved for this preview only. No verification was submitted.", progress: 1, cameraReady: publicCompleted.current && !enrollment.current });
      completion.current?.();
    }).catch(error => {
      if (active.signal.aborted) return;
      active.abort(); clearImage();
      setProcessingStep(null); setImage(undefined); setState(error instanceof PoseGuardRejected
        ? { phase: "error", title: error.result.status === "inconclusive" ? "Let's get a clearer view" : "Let's try that again", hint: error.result.outcome === "eyes_turned_with_head" ? "All four movements were captured, but we couldn't confirm your eyes stayed on the screen. On the next try, keep looking at the dot while turning your head." : error.result.reason, progress: 0, cameraReady: false }
        : preparing || enrolling ? enrollmentFailure(error) : captureFailure(error));
    }).finally(() => clearTimeout(deadline));
    return () => {
      clearTimeout(deadline);
      active.abort();
      if (controller.current === active) controller.current = null;
      clearImage();
    };
  }, [attempt, visible, poseguard]);

  const complete = state.phase === "complete";
  const transitioning = complete && !!onComplete;
  return <section className="selfie-check" data-state={state.phase} data-poseguard={poseguard || undefined} data-camera-ready={state.cameraReady} data-transitioning={transitioning} aria-label={poseguard ? "Movement check" : "Selfie capture"}>
    <header className="selfie-header" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <button className="selfie-close" type="button" aria-label={backLabel} onClick={close}><img src="/assets/figma/close.svg" alt="" /></button>
    </header>
    {processingStep ? <RequestProcessing step={processingStep} /> : <div className="selfie-content">
      <h1>{poseguard ? "Follow the movements" : "Selfie check"}</h1>
      <div className="selfie-camera-stage">
        <div className="selfie-camera-surface">
          <video ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
          {image && <img className="selfie-photo" src={image} alt="Your captured selfie" />}
          {complete && !transitioning && <div className="selfie-complete" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="m13 24 7 7 15-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
        </div>
        <svg className="selfie-camera-ring" viewBox="0 0 280 350" fill="none" aria-hidden="true"><ellipse className="selfie-ring-track" cx="140" cy="175" rx="133" ry="168" /><path className="selfie-ring-progress" d="M140 7a133 168 0 1 1 0 336a133 168 0 1 1 0-336" pathLength="100" style={{ strokeDashoffset: 100 - state.progress * 100 }} /></svg>
        <CaptureProgressRing progress={state.progress} />
        {poseguard && state.cameraReady && !complete && <span className="poseguard-fixation" aria-hidden="true" />}
        {state.pose && <>
          <div className="poseguard-steps" aria-label={`Movement ${state.pose.step} of ${state.pose.total}`}>
            {Array.from({ length: state.pose.total }, (_, index) => <span key={index} data-done={index < state.pose!.step - 1} data-current={index === state.pose!.step - 1} />)}
          </div>
          {state.pose.direction !== undefined && <span className="poseguard-target"
            style={{ "--poseguard-direction": `${state.pose.direction}deg` } as CSSProperties} aria-hidden="true" />}
        </>}
        <div className="selfie-feedback" role="status" aria-live="polite" aria-atomic="true"><div className="selfie-guidance"><h2>{state.title}</h2></div><p className="selfie-hint">{state.hint}</p></div>
      </div>
      {(!transitioning && (complete || state.phase === "error")) && <div className="selfie-actions">
        <button className="selfie-retry" type="button" onClick={restart}>{complete ? poseguard ? "Try again" : "Retake selfie" : "Try again"}</button>
        {complete && <button className="selfie-retry" type="button" onClick={close}>{backLabel}</button>}
      </div>}
    </div>}
    {!processingStep && <footer className="selfie-footer" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <p className="selfie-privacy"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="5" y="8.5" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M7 8.5v-3a3 3 0 0 1 6 0v3M10 12v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>{enroll ? "Your selfie is encrypted for a verified secure enclave." : "Your camera images stay on this device."}</p>
      <details className="selfie-about"><summary>About this check</summary><p>{enroll
        ? `${poseguard ? "This beta checks head and eye movements in your browser. " : ""}Your selfie is encrypted for a secure enclave after its software is verified. The image is not saved. After your check finishes, you can choose to save your authenticator with a passkey.`
        : poseguard ? "This demo checks head and eye movements in your browser. Images are kept in memory and cleared when you leave. It does not issue a credential or verify your identity."
        : "This preview captures your selfie in your browser. Nothing is uploaded or saved to storage. It does not submit enrollment or verify your identity. Images are cleared when you leave."}</p></details>
    </footer>}
    {diagnostics && <details className="selfie-debug"><summary>Capture diagnostics</summary><pre>{timing || "No capture yet."}</pre></details>}
  </section>;
}
