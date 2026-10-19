import { useEffect, useRef, useState, type ReactNode } from "react";
import { CAMERA_CAPTURE_CONFIG, type CapturePhase } from "./capture";
import { captureFailure, captureSelfie, INITIAL_CAPTURE_STATE, type CaptureState } from "./session";
import "./selfie-check.css";

/** Local capture only. Completion does not issue a credential or satisfy an RP request. */
export default function SelfieCheck({ onClose, backLabel, diagnostics = false, footerActions }: {
  onClose: () => void;
  backLabel: string;
  diagnostics?: boolean;
  footerActions?: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [lightGuard, setLightGuard] = useState(false);
  const [illumination, setIllumination] = useState<CapturePhase>();
  const [images, setImages] = useState<{ url: string; phase: CapturePhase }[]>([]);
  const [timing, setTiming] = useState("");

  const restart = () => {
    controller.current?.abort();
    setImages([]); setTiming(""); setIllumination(undefined);
    setState(INITIAL_CAPTURE_STATE); setAttempt(value => value + 1);
  };
  const close = () => { controller.current?.abort(); onClose(); };

  useEffect(() => {
    const pause = () => {
      controller.current?.abort();
      setVisible(false); setImages([]); setTiming(""); setIllumination(undefined);
      setState({ phase: "paused", title: "Your camera is off", hint: "Return to this page to start fresh.", progress: 0, cameraReady: false });
    };
    const visibility = () => {
      if (document.hidden) pause();
      else { setState(INITIAL_CAPTURE_STATE); setVisible(true); setAttempt(value => value + 1); }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
    };
  }, []);

  useEffect(() => {
    if (!visible || !video.current) return;
    const active = new AbortController();
    controller.current = active;
    const timeout = new AbortController();
    const deadline = setTimeout(() => timeout.abort(new DOMException("Capture timed out", "TimeoutError")), CAMERA_CAPTURE_CONFIG.timeoutMs);
    const signal = AbortSignal.any([active.signal, timeout.signal]);
    const urls: string[] = [];
    void captureSelfie(video.current, lightGuard, signal, next => {
      if (!signal.aborted) setState(next);
    }, phase => { if (!signal.aborted) setIllumination(phase); }).then(result => {
      if (signal.aborted) return;
      const captured = result.images.map(image => {
        const url = URL.createObjectURL(image.blob);
        urls.push(url);
        return { phase: image.phase, url };
      });
      setImages(captured); setTiming(JSON.stringify(result.timing, null, 2));
      setState({ phase: "complete", title: "Selfie captured", hint: "Saved for this preview only. No verification was submitted.", progress: 1, cameraReady: false });
    }).catch(error => {
      if (active.signal.aborted) return;
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      setIllumination(undefined); setImages([]); setState(captureFailure(error));
    }).finally(() => clearTimeout(deadline));
    return () => {
      clearTimeout(deadline);
      active.abort();
      if (controller.current === active) controller.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [attempt, lightGuard, visible]);

  const complete = state.phase === "complete";
  const phaseColors = illumination ? CAMERA_CAPTURE_CONFIG[illumination] : undefined;
  return <section className="selfie-check" data-state={state.phase} data-camera-ready={state.cameraReady} data-phase={illumination} aria-label="Selfie capture" style={phaseColors ? { backgroundColor: phaseColors.background, color: phaseColors.foreground } : undefined}>
    <header className="selfie-header">
      <button className="selfie-close" type="button" aria-label={backLabel} onClick={close}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
      <span className="selfie-brand"><img src="/assets/brand/human-badge.svg" width="24" height="24" alt="" />World ID</span>
    </header>
    <div className="selfie-content">
      <h1>Selfie check</h1>
      <div className="selfie-camera-stage">
        <div className="selfie-camera-surface">
          <video ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
          {images[0] && <img className="selfie-photo" src={images[0].url} alt="Your captured selfie" />}
          <div className="selfie-placeholder" aria-hidden="true"><svg viewBox="0 0 140 180" fill="none"><path d="M45 67c0-23 9-37 25-37s25 14 25 37c0 24-10 41-25 41S45 91 45 67Z" stroke="currentColor" strokeWidth="1.5" /><path d="M19 161v-12c0-18 24-31 51-31s51 13 51 31v12M60 73h1m18 0h1M62 89c5 4 11 4 16 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></div>
          {complete && <div className="selfie-complete" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="m13 24 7 7 15-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
        </div>
        <svg className="selfie-camera-ring" viewBox="0 0 280 350" fill="none" aria-hidden="true"><ellipse className="selfie-ring-track" cx="140" cy="175" rx="133" ry="168" /><path className="selfie-ring-progress" d="M140 7a133 168 0 1 1 0 336a133 168 0 1 1 0-336" pathLength="100" style={{ strokeDashoffset: 100 - state.progress * 100 }} /></svg>
        <div className="selfie-feedback" role="status" aria-live="polite" aria-atomic="true"><div className="selfie-guidance"><h2>{state.title}</h2></div><p className="selfie-hint">{state.hint}</p></div>
      </div>
      {(complete || state.phase === "error") && <div className="selfie-actions">
        <button className="selfie-retry" type="button" onClick={restart}>{complete ? "Retake selfie" : "Try again"}</button>
        {complete && <button className="selfie-retry" type="button" onClick={close}>{backLabel}</button>}
      </div>}
    </div>
    <footer className="selfie-footer">
      <p className="selfie-privacy"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="5" y="8.5" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M7 8.5v-3a3 3 0 0 1 6 0v3M10 12v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>Your selfie stays on this device.</p>
      <details className="selfie-about"><summary>About this check</summary><p>This preview captures your selfie in your browser. Nothing is uploaded or saved to storage. It does not submit enrollment or verify your identity. Images are cleared when you leave.</p></details>
      {footerActions}
    </footer>
    {diagnostics && <details className="selfie-debug"><summary>Capture diagnostics</summary>
      <label>Capture mode <select value={lightGuard ? "lightguard" : "vanilla"} onChange={event => { restart(); setLightGuard(event.target.value === "lightguard"); }}><option value="vanilla">Single image</option><option value="lightguard">White / black pair</option></select></label>
      <p>The pair changes screen colors. Device brightness is unchanged. No LightGuard verdict is produced.</p>
      <div className="selfie-frames">{images.map(image => <figure key={image.url}><img src={image.url} alt={`${image.phase} candidate frame`} /><figcaption>{image.phase}</figcaption></figure>)}</div><pre>{timing || "No capture yet."}</pre>
    </details>}
  </section>;
}
