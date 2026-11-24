import { use, useEffect, useRef, useState } from "react";
import type { RunPoseGuard } from "../lib/poseguard/enrollment";
import { CaptureScreenContext } from "../AppShell";
import { CAPTURE_TIMEOUT_MS, captureFailure, captureSelfie, INITIAL_CAPTURE_STATE, type CaptureState } from "../lib/selfie-capture";
import { CaptureProgressRing } from "./CaptureProgressRing";
import { PoseTargetIndicator } from "./PoseTargetIndicator";
import { logCaptureFailure, logCaptureTiming } from "../lib/flow-logging";

// 11 units inside the ring viewBox, scaling with the aperture on narrow screens.
const APERTURE_INSET = "absolute inset-x-[calc(11/345.005*100%)] inset-y-[calc(11/481.637*100%)]";
// Reserve vertical space for camera guidance, controls, and safe-area padding.
const CAMERA_WIDTH = "w-[min(345px,max(60px,calc((100svh_-_292px)*0.7163)))]";
const RETRY = "min-h-12 max-w-45 flex-1 rounded-2xl bg-background-secondary p-3 text-[15px] text-foreground hover:bg-[#ededed]";

export default function SelfieCheck({ onClose, onComplete, backLabel, completionHint, enroll }: {
  onClose: () => void;
  onComplete?: () => void;
  backLabel: string;
  completionHint?: string;
  enroll?: RunPoseGuard;
}) {
  const setCaptureActive = use(CaptureScreenContext);
  useEffect(() => { setCaptureActive(true); return () => setCaptureActive(false); }, [setCaptureActive]);
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  const completion = useRef(onComplete);
  const publicCompleted = useRef(false);
  const enrollmentFinished = useRef(false);
  const imageUrl = useRef<string | undefined>(undefined);
  useEffect(() => { completion.current = onComplete; }, [onComplete]);
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [image, setImage] = useState<string>();

  const clearImage = () => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = undefined;
  };
  const restart = () => {
    controller.current?.abort();
    clearImage(); setImage(undefined);
    setState(INITIAL_CAPTURE_STATE); setAttempt(value => value + 1);
  };
  const close = () => { controller.current?.abort(); onClose(); };

  useEffect(() => {
    const pause = () => {
      controller.current?.abort();
      setVisible(false); setImage(undefined);
      setState({ phase: "paused", title: "Your camera is off", hint: "Return to this page to start fresh.", progress: 0, cameraReady: false });
    };
    const visibility = () => {
      if (enrollmentFinished.current) return;
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
    if (enroll) {
      void enroll(video.current, active.signal, next => {
        if (active.signal.aborted) return;
        setState(next);
      }).then(outcome => {
        if (active.signal.aborted) return;
        // The run kept the preview live through processing; the result screen ends it.
        active.abort();
        enrollmentFinished.current = outcome !== "pending";
        const title = {
          captured: "PoseGuard captures accepted",
          completed: "Enrollment complete",
          duplicate: "Face already enrolled",
          failed: "Enrollment failed",
          pending: "Enrollment pending",
        }[outcome];
        setState({ phase: outcome === "pending" ? "pending" : "complete", title, hint: "", progress: outcome === "failed" || outcome === "duplicate" ? 0 : 1, cameraReady: false });
      }).catch(error => {
        if (active.signal.aborted) return;
        active.abort();
        logCaptureFailure(error);
        setState(captureFailure(error));
      });
      return () => {
        active.abort();
        if (controller.current === active) controller.current = null;
      };
    }
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
      logCaptureTiming(result.timing);
      setState({ phase: "complete", title: publicCompleted.current ? "Selfie completed" : "Selfie captured", hint: publicCompleted.current ? "" : "Saved for this preview only. No verification was submitted.", progress: 1, cameraReady: publicCompleted.current });
      completion.current?.();
    }).catch(error => {
      if (active.signal.aborted) return;
      active.abort(); clearImage();
      logCaptureFailure(error);
      setImage(undefined); setState(captureFailure(error));
    }).finally(() => clearTimeout(deadline));
    return () => {
      clearTimeout(deadline);
      active.abort();
      if (controller.current === active) controller.current = null;
      clearImage();
    };
  }, [attempt, visible, enroll]);

  const complete = state.phase === "complete";
  const transitioning = complete && !!onComplete;
  const showVideo = !(complete && !transitioning) && !(transitioning && !state.cameraReady);
  return <section className="group/selfie fixed inset-0 z-40 m-auto flex h-[100svh] w-full max-w-[393px] flex-col overflow-y-auto bg-white px-6 pt-[max(16px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]" data-state={state.phase} data-camera-ready={state.cameraReady} data-transitioning={transitioning} aria-label="Selfie capture">
    <header className="relative flex min-h-11 items-center justify-center" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <button className="absolute left-0 grid size-11 place-items-center rounded-full bg-background-secondary text-foreground hover:bg-[#ededed]" type="button" aria-label={backLabel} onClick={close}><img className="size-6" src="/assets/figma/close.svg" alt="" /></button>
    </header>
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-2 text-center">
      <h1 className="sr-only">Selfie check</h1>
      <div role="status" aria-live="polite" aria-atomic="true" className="w-full text-center">
        {state.poseStep && <p className="mb-1 text-xs text-foreground-secondary">Step {state.poseStep.index} of {state.poseStep.total}</p>}
        <h2 className="text-[15px] leading-[1.3] text-foreground" data-testid="selfie-guidance">{state.title}</h2>
        {(completionHint || state.hint) && <p className="mx-auto mt-1 max-w-[330px] text-[14px] leading-[1.35] text-foreground-secondary">{completionHint || state.hint}</p>}
      </div>
      <div className={`relative aspect-[345.005/481.637] ${CAMERA_WIDTH} max-w-full`} data-testid="selfie-camera-stage">
        <div className={`${APERTURE_INSET} overflow-hidden rounded-[50%] bg-background-secondary`}>
          <video className={`size-full object-cover -scale-x-100 transition-opacity duration-250 ease-[ease] ${state.cameraReady ? "opacity-100" : "opacity-0"} ${showVideo ? "" : "hidden"}`} ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
          {image && <img className="size-full object-cover -scale-x-100" data-testid="selfie-photo" src={image} alt="Your captured selfie" />}
          {complete && !transitioning && !enroll && <div className="absolute inset-0 grid place-items-center bg-[rgb(0_0_0/16%)] text-white" data-testid="selfie-complete" aria-hidden="true"><svg className="size-14 rounded-full bg-accent p-[9px]" viewBox="0 0 48 48" fill="none"><path d="m13 24 7 7 15-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
        </div>
        <svg className="hidden" viewBox="0 0 280 350" fill="none" aria-hidden="true"><ellipse className="stroke-[#e3e3e3] stroke-2" cx="140" cy="175" rx="133" ry="168" /><path className="stroke-accent stroke-[2.5] transition-[stroke-dashoffset] duration-120 ease-linear" data-testid="selfie-ring-progress" d="M140 7a133 168 0 1 1 0 336a133 168 0 1 1 0-336" pathLength="100" strokeLinecap="round" strokeDasharray="100" style={{ strokeDashoffset: 100 - state.progress * 100 }} /></svg>
        <CaptureProgressRing progress={state.progress} poseGuard={!!enroll} />
        {state.target && <PoseTargetIndicator target={state.target} />}
      </div>
      {(!transitioning && (complete || state.phase === "error" || state.phase === "pending")) && <div className="flex w-full justify-center gap-2">
        {(!enroll || !complete) && <button className={RETRY} type="button" onClick={restart}>
          {state.phase === "pending" ? "Check status" : complete ? "Retake selfie" : "Try again"}
        </button>}
        {complete && <button className={RETRY} type="button" onClick={close}>{backLabel}</button>}
      </div>}
    </div>
    {!enroll && <footer className="mt-auto text-center text-[12px] text-foreground-secondary" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <p className="flex items-center justify-center gap-1.5"><svg className="size-4" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="5" y="8.5" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M7 8.5v-3a3 3 0 0 1 6 0v3M10 12v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>Your selfie stays on this device.</p>
      <details><summary className="inline-flex min-h-11 cursor-pointer list-none items-center underline underline-offset-3 [&::-webkit-details-marker]:hidden">About this check</summary><p className="mx-auto mt-[3px] mb-3 max-w-[310px] leading-[1.6]">This preview captures your selfie in your browser. Nothing is uploaded or saved to storage. It does not submit enrollment or verify your identity. Images are cleared when you leave.</p></details>
    </footer>}
  </section>;
}
