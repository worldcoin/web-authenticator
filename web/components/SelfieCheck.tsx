import { useEffect, useRef, useState } from "react";
import { CAPTURE_TIMEOUT_MS, captureFailure, captureSelfie, INITIAL_CAPTURE_STATE, type CaptureState } from "../lib/selfie-capture";
import { CaptureProgressRing } from "./CaptureProgressRing";

// 11 units inside the ring viewBox, scaling with the aperture on narrow screens.
const APERTURE_INSET = "absolute inset-x-[calc(11/345.005*100%)] inset-y-[calc(11/481.637*100%)]";
const RETRY = "min-h-12 max-w-45 flex-1 rounded-2xl bg-background-secondary p-3 text-[15px] text-foreground hover:bg-[#ededed]";

/** Local capture only. Completion does not issue a credential or satisfy an RP request. */
export default function SelfieCheck({ onClose, onComplete, backLabel, diagnostics = false }: {
  onClose: () => void;
  onComplete?: () => void;
  backLabel: string;
  diagnostics?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  const completion = useRef(onComplete);
  const publicCompleted = useRef(false);
  const imageUrl = useRef<string | undefined>(undefined);
  useEffect(() => { completion.current = onComplete; }, [onComplete]);
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
    clearImage(); setImage(undefined); setTiming("");
    setState(INITIAL_CAPTURE_STATE); setAttempt(value => value + 1);
  };
  const close = () => { controller.current?.abort(); onClose(); };

  useEffect(() => {
    const pause = () => {
      controller.current?.abort();
      setVisible(false); setImage(undefined); setTiming("");
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
    const deadline = setTimeout(() => timeout.abort(new DOMException("Capture timed out", "TimeoutError")), CAPTURE_TIMEOUT_MS);
    const signal = AbortSignal.any([active.signal, timeout.signal]);
    void captureSelfie(video.current, signal, next => {
      if (!signal.aborted) setState(next);
    }, { retainPreviewUntilAbort: !!completion.current }).then(result => {
      if (signal.aborted) return;
      imageUrl.current = URL.createObjectURL(result.image);
      publicCompleted.current = !!completion.current;
      if (!publicCompleted.current) setImage(imageUrl.current);
      setTiming(JSON.stringify(result.timing, null, 2));
      setState({ phase: "complete", title: publicCompleted.current ? "Selfie completed" : "Selfie captured", hint: publicCompleted.current ? "" : "Saved for this preview only. No verification was submitted.", progress: 1, cameraReady: publicCompleted.current });
      completion.current?.();
    }).catch(error => {
      if (active.signal.aborted) return;
      active.abort(); clearImage();
      setImage(undefined); setState(captureFailure(error));
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
  const showVideo = !(complete && !transitioning) && !(transitioning && !state.cameraReady);
  const showPlaceholder = state.phase === "paused" || state.phase === "error" || (!state.cameraReady && !complete);
  return <section className="group/selfie m-auto flex w-full max-w-[393px] min-h-(--request-frame-min-height) flex-col px-6 pt-[max(16px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]" data-state={state.phase} data-camera-ready={state.cameraReady} data-transitioning={transitioning} aria-label="Selfie capture">
    <header className="relative flex min-h-11 items-center justify-center" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <button className="absolute left-0 grid size-11 place-items-center rounded-full bg-background-secondary text-foreground hover:bg-[#ededed]" type="button" aria-label={backLabel} onClick={close}><img className="size-6" src="/assets/figma/close.svg" alt="" /></button>
    </header>
    <div className="flex flex-1 flex-col items-center justify-center pt-16 pb-6 text-center short:pt-8">
      <h1 className="sr-only">Selfie check</h1>
      <div className="relative mb-[76px] aspect-[345.005/481.637] w-[345px] max-w-full" data-testid="selfie-camera-stage">
        <div className={`${APERTURE_INSET} overflow-hidden rounded-[50%] bg-background-secondary`}>
          <video className={`size-full object-cover -scale-x-100 transition-opacity duration-250 ease-[ease] ${state.cameraReady ? "opacity-100" : "opacity-0"} ${showVideo ? "" : "hidden"}`} ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
          {image && <img className="size-full object-cover -scale-x-100" data-testid="selfie-photo" src={image} alt="Your captured selfie" />}
          <div className={`absolute inset-0 place-items-center text-[#b5b5b5] ${showPlaceholder ? "grid" : "hidden"}`} aria-hidden="true"><svg className="w-[47%]" viewBox="0 0 140 180" fill="none"><path d="M45 67c0-23 9-37 25-37s25 14 25 37c0 24-10 41-25 41S45 91 45 67Z" stroke="currentColor" strokeWidth="1.5" /><path d="M19 161v-12c0-18 24-31 51-31s51 13 51 31v12M60 73h1m18 0h1M62 89c5 4 11 4 16 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></div>
          {complete && !transitioning && <div className="absolute inset-0 grid place-items-center bg-[rgb(0_0_0/16%)] text-white" data-testid="selfie-complete" aria-hidden="true"><svg className="size-14 rounded-full bg-accent p-[9px]" viewBox="0 0 48 48" fill="none"><path d="m13 24 7 7 15-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
        </div>
        <svg className="hidden" viewBox="0 0 280 350" fill="none" aria-hidden="true"><ellipse className="stroke-[#e3e3e3] stroke-2" cx="140" cy="175" rx="133" ry="168" /><path className="stroke-accent stroke-[2.5] transition-[stroke-dashoffset] duration-120 ease-linear" data-testid="selfie-ring-progress" d="M140 7a133 168 0 1 1 0 336a133 168 0 1 1 0-336" pathLength="100" strokeLinecap="round" strokeDasharray="100" style={{ strokeDashoffset: 100 - state.progress * 100 }} /></svg>
        <CaptureProgressRing progress={state.progress} />
        <div className={`${APERTURE_INSET} pointer-events-none`} role="status" aria-live="polite" aria-atomic="true">
          <div className="absolute top-[12.2%] left-1/2 flex min-h-9 w-max max-w-[calc(100%_-_48px)] -translate-x-1/2 items-center rounded-xl bg-[rgb(24_24_24/60%)] px-3 py-2 text-white backdrop-blur-[10px]" data-testid="selfie-guidance"><h2 className="text-[15px] font-[350] leading-[1.3] tracking-[-0.075px]">{state.title}</h2></div>
          <p className="absolute top-[calc(100%_+_26px)] left-1/2 w-[min(330px,calc(100%_+_30px))] -translate-x-1/2 text-[14px] leading-[1.45] text-foreground-secondary">{state.hint}</p>
        </div>
      </div>
      {(!transitioning && (complete || state.phase === "error")) && <div className="flex w-full justify-center gap-2">
        <button className={RETRY} type="button" onClick={restart}>{complete ? "Retake selfie" : "Try again"}</button>
        {complete && <button className={RETRY} type="button" onClick={close}>{backLabel}</button>}
      </div>}
    </div>
    <footer className="mt-auto text-center text-[12px] text-foreground-secondary" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <p className="flex items-center justify-center gap-1.5"><svg className="size-4" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="5" y="8.5" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M7 8.5v-3a3 3 0 0 1 6 0v3M10 12v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>Your selfie stays on this device.</p>
      <details><summary className="inline-flex min-h-11 cursor-pointer list-none items-center underline underline-offset-3 [&::-webkit-details-marker]:hidden">About this check</summary><p className="mx-auto mt-[3px] mb-3 max-w-[310px] leading-[1.6]">This preview captures your selfie in your browser. Nothing is uploaded or saved to storage. It does not submit enrollment or verify your identity. Images are cleared when you leave.</p></details>
    </footer>
    {diagnostics && <details className="mt-6 rounded-xl border border-[#e3e3e3] p-4 text-[12px]"><summary>Capture diagnostics</summary><pre className="whitespace-pre-wrap text-[10px]">{timing || "No capture yet."}</pre></details>}
  </section>;
}
