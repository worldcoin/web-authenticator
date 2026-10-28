import { useEffect, useRef, useState } from "react";
import { CAPTURE_TIMEOUT_MS, captureFailure, captureSelfie, enrollmentFailure, ENROLLMENT_STATE, INITIAL_CAPTURE_STATE, type CaptureState } from "../lib/selfie-capture";
import "./SelfieCheck.css";
import RequestProcessing from "./RequestProcessing";
import { CaptureProgressRing } from "./CaptureProgressRing";

/** Optional attested extraction; completion does not issue a credential or satisfy an RP request. */
export default function SelfieCheck({ onClose, onComplete, enroll, backLabel, diagnostics = false }: {
  onClose: () => void;
  onComplete?: () => void;
  enroll?: (image: Blob, signal: AbortSignal) => Promise<unknown>;
  backLabel: string;
  diagnostics?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  const completion = useRef(onComplete);
  const enrollment = useRef(enroll);
  const imageUrl = useRef<string | undefined>(undefined);
  useEffect(() => { completion.current = onComplete; }, [onComplete]);
  useEffect(() => { enrollment.current = enroll; }, [enroll]);
  const [processing, setProcessing] = useState(false);
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [image, setImage] = useState<string>();
  const [timing, setTiming] = useState("");

  const clearImage = () => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = undefined;
  };
  const restart = () => {
    controller.current?.abort();
    clearImage(); setImage(undefined); setTiming(""); setProcessing(false);
    setState(INITIAL_CAPTURE_STATE); setAttempt(value => value + 1);
  };
  const close = () => { controller.current?.abort(); onClose(); };

  useEffect(() => {
    const pause = () => {
      controller.current?.abort();
      setVisible(false); setImage(undefined); setTiming(""); setProcessing(false);
      setState({ phase: "paused", title: "Your camera is off", hint: "Return to this page to start fresh.", progress: 0, cameraReady: false });
    };
    const visibility = () => {
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
    const deadline = setTimeout(() => timeout.abort(new DOMException("Capture timed out", "TimeoutError")), CAPTURE_TIMEOUT_MS);
    const signal = AbortSignal.any([active.signal, timeout.signal]);
    let enrolling = false;
    void captureSelfie(video.current, signal, next => {
      if (!signal.aborted) setState(next);
    }).then(async result => {
      if (signal.aborted) return;
      clearTimeout(deadline);
      if (enrollment.current) {
        enrolling = true;
        setProcessing(true);
        setState(ENROLLMENT_STATE);
        await enrollment.current(result.image, active.signal);
        if (active.signal.aborted) return;
      }
      setProcessing(false);
      if (completion.current) {
        completion.current();
        return;
      }
      imageUrl.current = URL.createObjectURL(result.image);
      setImage(imageUrl.current);
      setTiming(JSON.stringify(result.timing, null, 2));
      setState({ phase: "complete", title: "Selfie captured", hint: "Saved for this preview only. No verification was submitted.", progress: 1, cameraReady: false });
    }).catch(error => {
      if (active.signal.aborted) return;
      active.abort(); clearImage();
      setProcessing(false); setImage(undefined); setState(enrolling ? enrollmentFailure(error) : captureFailure(error));
    }).finally(() => clearTimeout(deadline));
    return () => {
      clearTimeout(deadline);
      active.abort();
      if (controller.current === active) controller.current = null;
      clearImage();
    };
  }, [attempt, visible]);

  const complete = state.phase === "complete";
  const transitioning = complete && !!onComplete;
  return <section className="selfie-check" data-state={state.phase} data-camera-ready={state.cameraReady} data-transitioning={transitioning} aria-label="Selfie capture">
    <header className="selfie-header" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <button className="selfie-close" type="button" aria-label={backLabel} onClick={close}><img src="/assets/figma/close.svg" alt="" /></button>
    </header>
    {processing ? <RequestProcessing /> : <div className="selfie-content">
      <h1>Selfie check</h1>
      <div className="selfie-camera-stage">
        <div className="selfie-camera-surface">
          <video ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
          {image && <img className="selfie-photo" src={image} alt="Your captured selfie" />}
          <div className="selfie-placeholder" aria-hidden="true"><svg viewBox="0 0 140 180" fill="none"><path d="M45 67c0-23 9-37 25-37s25 14 25 37c0 24-10 41-25 41S45 91 45 67Z" stroke="currentColor" strokeWidth="1.5" /><path d="M19 161v-12c0-18 24-31 51-31s51 13 51 31v12M60 73h1m18 0h1M62 89c5 4 11 4 16 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></div>
          {complete && !transitioning && <div className="selfie-complete" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="m13 24 7 7 15-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
        </div>
        <svg className="selfie-camera-ring" viewBox="0 0 280 350" fill="none" aria-hidden="true"><ellipse className="selfie-ring-track" cx="140" cy="175" rx="133" ry="168" /><path className="selfie-ring-progress" d="M140 7a133 168 0 1 1 0 336a133 168 0 1 1 0-336" pathLength="100" style={{ strokeDashoffset: 100 - state.progress * 100 }} /></svg>
        <CaptureProgressRing progress={state.progress} />
        <div className="selfie-feedback" role="status" aria-live="polite" aria-atomic="true"><div className="selfie-guidance"><h2>{state.title}</h2></div><p className="selfie-hint">{state.hint}</p></div>
      </div>
      {(!transitioning && (complete || state.phase === "error")) && <div className="selfie-actions">
        <button className="selfie-retry" type="button" onClick={restart}>{complete ? "Retake selfie" : "Try again"}</button>
        {complete && <button className="selfie-retry" type="button" onClick={close}>{backLabel}</button>}
      </div>}
    </div>}
    {!processing && <footer className="selfie-footer" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <p className="selfie-privacy"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="5" y="8.5" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M7 8.5v-3a3 3 0 0 1 6 0v3M10 12v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>{enroll ? "Your selfie is encrypted for a verified secure enclave." : "Your selfie stays on this device."}</p>
      <details className="selfie-about"><summary>About this check</summary><p>{enroll ? "Your selfie is encrypted for a secure enclave after its software is verified. The image is not saved. This check does not issue a credential or complete the requesting app’s proof." : "This preview captures your selfie in your browser. Nothing is uploaded or saved to storage. It does not submit enrollment or verify your identity. Images are cleared when you leave."}</p></details>
    </footer>}
    {diagnostics && <details className="selfie-debug"><summary>Capture diagnostics</summary><pre>{timing || "No capture yet."}</pre></details>}
  </section>;
}
