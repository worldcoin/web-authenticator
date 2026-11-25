import { use, useEffect, useRef, useState } from "react";
import type { RunPoseGuard } from "../lib/poseguard/enrollment";
import { CaptureScreenContext } from "../AppShell";
import { CAPTURE_TIMEOUT_MS, captureFailure, captureSelfie, INITIAL_CAPTURE_STATE, type CaptureState } from "../lib/selfie-capture";
import { CaptureProgressRing } from "./CaptureProgressRing";
import { ProcessingStatus, type EndAction } from "./ProcessingStatus";
import { bumperGap, PoseTargetIndicator, targetDegrees } from "./PoseTargetIndicator";
import { logCaptureFailure, logCaptureTiming } from "../lib/flow-logging";
import { Button } from "../design/Button";
import { iconButtonStyle } from "../design/buttons";
import { Icon } from "../design/Icon";
import { Spinner } from "../design/Spinner";

// 11 units inside the ring viewBox, scaling with the aperture on narrow screens.
const APERTURE_INSET = "absolute inset-x-[calc(11/345.005*100%)] inset-y-[calc(11/481.637*100%)]";
// Reserve vertical space for camera guidance, controls, and safe-area padding.
const CAMERA_WIDTH = "w-[min(345px,max(60px,calc((100svh_-_292px)*0.7163)))]";
const RETRY = "max-w-45 flex-1";

export default function SelfieCheck({ onClose, onComplete, backLabel, completionHint, enroll, endAction }: {
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
  const controller = useRef<AbortController | null>(null);
  const completion = useRef(onComplete);
  const publicCompleted = useRef(false);
  const enrollmentFinished = useRef(false);
  const imageUrl = useRef<string | undefined>(undefined);
  useEffect(() => { completion.current = onComplete; }, [onComplete]);
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [attempt, setAttempt] = useState(0);
  // A completed PoseGuard run ends on the processing screen's flood into "You're all set".
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
      void enroll(video.current, active.signal, next => {
        if (active.signal.aborted) return;
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
  // After the last capture the camera is off; processing shows its message alone, with a spinner for PoseGuard.
  const textOnly = state.phase === "checking" && !state.cameraReady;
  const processing = textOnly && !!enroll;
  // PoseGuard puts live guidance in a pill over the camera; results, errors and processing stay as text above it.
  const pill = !!enroll && !textOnly && ["starting", "framing", "holding", "captured", "checking"].includes(state.phase);
  return <section className="group/selfie fixed inset-0 z-40 m-auto flex h-[100svh] w-full max-w-[393px] flex-col overflow-y-auto bg-surface-page px-6 pt-[max(16px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]" data-state={state.phase} data-camera-ready={state.cameraReady} data-transitioning={transitioning} aria-label="Selfie capture">
    <header className="relative flex min-h-11 items-center justify-center" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <button className={`${iconButtonStyle("secondary40")} absolute left-0`} type="button" aria-label={backLabel} onClick={close}><Icon icon="xmark" className="size-5" /></button>
    </header>
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-2 text-center">
      <h1 className="sr-only">Proof of Presence</h1>
      {processing && <ProcessingStatus title={state.title} hint={state.hint} done={allSet} endAction={endAction} />}
      {!pill && !processing && <div role="status" aria-live="polite" aria-atomic="true" className="w-full text-center">
        <h2 className="text-b2 text-foreground-primary" data-testid="selfie-guidance">{state.title}</h2>
        {(completionHint || state.hint) && <p className="mx-auto mt-1 max-w-[330px] text-b2 text-foreground-secondary">{completionHint || state.hint}</p>}
      </div>}
      <div className={`relative aspect-[345.005/481.637] ${CAMERA_WIDTH} max-w-full ${textOnly ? "hidden" : ""}`} data-testid="selfie-camera-stage">
        <div className={`${APERTURE_INSET} overflow-hidden rounded-[50%] bg-background-secondary`}>
          <video className={`size-full object-cover -scale-x-100 transition-opacity duration-250 ease-[ease] ${state.cameraReady ? "opacity-100" : "opacity-0"} ${showVideo ? "" : "hidden"}`} ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
          {image && <img className="size-full object-cover -scale-x-100" data-testid="selfie-photo" src={image} alt="Your captured selfie" />}
          {complete && !transitioning && !enroll && <div className="absolute inset-0 grid place-items-center bg-background-inverse/16" data-testid="selfie-complete" aria-hidden="true"><span className="grid size-14 place-items-center rounded-full bg-accent-blue"><Icon icon="check" className="size-8 text-foreground-inverse" /></span></div>}
        </div>
        <CaptureProgressRing progress={state.progress} gap={state.target ? bumperGap(state.target) : undefined} />
        {state.target && <PoseTargetIndicator target={state.target} aligned={state.phase === "holding"} />}
        {pill && <div role="status" aria-live="polite" aria-atomic="true" data-testid="selfie-guidance-pill"
          className="absolute top-[17%] left-1/2 flex max-w-[86%] -translate-x-1/2 items-center gap-2 rounded-xl bg-background-inverse/78 px-3.5 py-[9px] text-b2 text-foreground-inverse">
          <GuidanceIcon state={state} />
          <span data-testid="selfie-guidance">{state.title}</span>
        </div>}
      </div>
      {(!transitioning && (complete || state.phase === "error" || state.phase === "pending")) && <div className="flex w-full justify-center gap-2">
        {(!enroll || !complete) && <Button buttonStyle="secondary48" className={RETRY} onClick={restart}>
          {state.phase === "pending" ? "Check status" : complete ? "Retake selfie" : "Try again"}
        </Button>}
        {complete && <Button buttonStyle="secondary48" className={RETRY} onClick={close}>{backLabel}</Button>}
      </div>}
    </div>
    {!enroll && <footer className="mt-auto text-center text-b3 text-foreground-secondary" inert={transitioning} aria-hidden={transitioning || undefined} style={transitioning ? { visibility: "hidden" } : undefined}>
      <p className="flex items-center justify-center gap-1.5"><Icon icon="lock" className="size-4" />Your selfie stays on this device.</p>
      <details><summary className="inline-flex min-h-11 cursor-pointer list-none items-center underline underline-offset-3 [&::-webkit-details-marker]:hidden">About this check</summary><p className="mx-auto mt-[3px] mb-3 max-w-[310px]">This preview captures your selfie in your browser. Nothing is uploaded or saved to storage. It does not submit enrollment or verify your identity. Images are cleared when you leave.</p></details>
    </footer>}
  </section>;
}

/** An arrow towards a target, a spinner only until the targets arrive, and nothing once the user is being guided. */
function GuidanceIcon({ state }: { state: CaptureState }) {
  if (state.target) {
    // The wrapper turns the arrow, so the Nucleus icon keeps its own markup.
    return <span className="flex size-4 shrink-0" data-testid="guidance-arrow" style={{ transform: `rotate(${targetDegrees(state.target)}deg)` }}>
      <Icon icon="arrow-up" className="size-4" />
    </span>;
  }
  if (state.phase !== "starting" && state.phase !== "checking") return null;
  return <Spinner className="size-4 shrink-0" />;
}
