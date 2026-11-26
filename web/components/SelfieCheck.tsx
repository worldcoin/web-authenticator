import { use, useEffect, useRef, useState } from "react";
import type { RunPoseGuard } from "../lib/poseguard/enrollment";
import { CaptureScreenContext } from "../AppShell";
import { CAPTURE_TIMEOUT_MS, captureFailure, captureSelfie, INITIAL_CAPTURE_STATE, type CaptureState } from "../lib/selfie-capture";
import { CameraLoading } from "./CameraLoading";
import { CaptureProgressRing } from "./CaptureProgressRing";
import { ProcessingStatus, type EndAction } from "./ProcessingStatus";
import { PoseGuidance } from "./PoseGuidance";
import { bumperGap, PoseTargetIndicator } from "./PoseTargetIndicator";
import { logCaptureFailure, logCaptureTiming } from "../lib/flow-logging";
import { actions, completionTitle } from "./styles";
import { Button } from "../design/Button";
import { iconButtonStyle } from "../design/buttons";
import { Icon } from "../design/Icon";

// 11 units inside the ring viewBox, scaling with the aperture on narrow screens.
const APERTURE_INSET = "absolute inset-x-[calc(11/345.005*100%)] inset-y-[calc(11/481.637*100%)]";
// Reserve vertical space for camera guidance, controls, and safe-area padding.
const CAMERA_WIDTH = "w-[min(345px,max(60px,calc((var(--experience-height)_-_292px)*0.7163)))]";
const RETRY = "max-w-45 flex-1";

export default function SelfieCheck({ onClose, onComplete, backLabel, completionHint, enroll, endAction, fromRequest = false }: {
  fromRequest?: boolean;
  onClose: () => void;
  onComplete?: () => void;
  backLabel: string;
  completionHint?: string;
  enroll?: RunPoseGuard;
  /** What the PoseGuard end screen offers after "You're all set". */
  endAction?: EndAction;
}) {
  const setCaptureActive = use(CaptureScreenContext);
  useEffect(() => { setCaptureActive(true); return () => setCaptureActive(false); }, [setCaptureActive]);
  const video = useRef<HTMLVideoElement>(null);
  const aperture = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const completion = useRef(onComplete);
  const publicCompleted = useRef(false);
  const enrollmentFinished = useRef(false);
  const imageUrl = useRef<string | undefined>(undefined);
  useEffect(() => { completion.current = onComplete; }, [onComplete]);
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [departingRing, setDepartingRing] = useState<CaptureState>();
  const [attempt, setAttempt] = useState(0);
  const [allSet, setAllSet] = useState(false);
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
      let lastLivePose: CaptureState | undefined;
      void enroll(video.current, active.signal, next => {
        if (active.signal.aborted) return;
        if (next.cameraReady) lastLivePose = next;
        else if (next.phase !== "checking") lastLivePose = undefined;
        setDepartingRing(next.phase === "checking" && !next.cameraReady ? lastLivePose : undefined);
        setState(next);
      }).then(outcome => {
        if (active.signal.aborted) return;
        enrollmentFinished.current = outcome !== "pending";
        if (outcome === "completed") { setAllSet(true); return; }
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
  // Processing can also resume from a saved receipt without ever opening the camera.
  const textOnly = allSet || (state.phase === "checking" && !state.cameraReady);
  const processing = textOnly && !!enroll;
  const handoff = processing && !!departingRing;
  const ringState = handoff ? departingRing : state;
  // PoseGuard puts live guidance in a pill over the camera.
  const pill = !!enroll && !textOnly && ["starting", "framing", "holding", "captured", "checking"].includes(state.phase);
  return <section data-request-camera={fromRequest || undefined} className="group/selfie relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-surface-page pb-[max(20px,env(safe-area-inset-bottom))]" data-camera-handoff={handoff} data-state={state.phase} data-camera-ready={state.cameraReady} data-transitioning={transitioning} aria-label="Selfie capture">
    <header className="relative z-10 flex shrink-0 [--close-inset:max(20px,env(safe-area-inset-top),env(safe-area-inset-left))] pt-(--close-inset) pl-(--close-inset)" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <button className={iconButtonStyle("secondary40")} type="button" aria-label={backLabel} onClick={close}><Icon icon="xmark" className="size-5" /></button>
    </header>
    {state.phase === "error" ? <div className="flex flex-1 flex-col items-center px-6 min-[600px]:px-10">
      <div role="status" className="flex w-full max-w-[345px] flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
        <h1 className={completionTitle} data-testid="selfie-guidance">{state.title}</h1>
        {state.hint && <p className="text-b1 text-foreground-primary/70">{state.hint}</p>}
      </div>
      <div className={actions}><Button buttonStyle="primary48" className="w-full" onClick={restart}>Try again</Button></div>
    </div> : <>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-2 text-center min-[600px]:px-10">
        <h1 className="sr-only">Proof of Presence</h1>
        {processing && <ProcessingStatus title={state.title} hint={state.hint} done={allSet} endAction={endAction} />}
        {!pill && !processing && <div role="status" aria-live="polite" aria-atomic="true" className="flex min-h-16 w-full flex-col items-center justify-end text-center">
          <h2 className="text-b2 text-foreground-primary" data-testid="selfie-guidance">{state.title}</h2>
          {(completionHint || state.hint) && <p className="mx-auto mt-1 max-w-[330px] text-b2 text-foreground-primary/70">{completionHint || state.hint}</p>}
        </div>}
        <div className={`relative aspect-[345.005/481.637] ${CAMERA_WIDTH} max-w-full ${textOnly ? "hidden" : ""} ${handoff ? "motion-safe:block motion-safe:animate-oval-exit" : ""}`} data-testid="selfie-camera-stage">
          <div ref={aperture} hidden={textOnly} className={`camera-aperture ${APERTURE_INSET} overflow-hidden rounded-[50%] bg-background-secondary`}>
            <video className={`size-full object-cover -scale-x-100 transition-opacity duration-250 ease-[ease] ${state.cameraReady ? "opacity-100" : "opacity-0"} ${showVideo ? "" : "hidden"}`} ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
            {image && <img className="size-full object-cover -scale-x-100" data-testid="selfie-photo" src={image} alt="Your captured selfie" />}
            {complete && !transitioning && !enroll && <div className="absolute inset-0 grid place-items-center bg-background-inverse/16" data-testid="selfie-complete" aria-hidden="true"><span className="grid size-14 place-items-center rounded-full bg-accent-blue"><Icon icon="check" className="size-8 text-foreground-inverse" /></span></div>}
          </div>
          <CaptureProgressRing progress={ringState.progress} gap={ringState.target ? bumperGap(ringState.target) : undefined} />
          {state.target && <PoseTargetIndicator target={state.target} aligned={state.phase === "holding"} />}
          {pill && (!fromRequest || !!state.poseStep) && <PoseGuidance state={state} />}
        </div>
        {(!transitioning && (complete || state.phase === "pending")) && <div className="flex w-full justify-center gap-2">
          {(!enroll || !complete) && <Button buttonStyle="secondary48" className={RETRY} onClick={restart}>
            {state.phase === "pending" ? "Check status" : "Retake selfie"}
          </Button>}
          {complete && <Button buttonStyle="secondary48" className={RETRY} onClick={close}>{backLabel}</Button>}
        </div>}
      </div>
      {!enroll && <footer className="relative z-10 mt-auto px-6 min-[600px]:px-10 text-center text-b3 text-foreground-primary/70" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
        <p className="flex items-center justify-center gap-1.5"><Icon icon="lock" className="size-4" />Your selfie stays on this device.</p>
        <details><summary className="inline-flex min-h-11 cursor-pointer list-none items-center underline underline-offset-3 [&::-webkit-details-marker]:hidden">About this check</summary><p className="mx-auto mt-[3px] mb-3 max-w-[310px]">This preview captures your selfie in your browser. Nothing is uploaded or saved to storage. It does not submit enrollment or verify your identity. Images are cleared when you leave.</p></details>
      </footer>}
      {(state.phase === "starting" || state.cameraReady) && !(fromRequest && state.cameraReady) && <CameraLoading key={attempt} ready={state.cameraReady} aperture={aperture} />}
    </>}
  </section>;
}
