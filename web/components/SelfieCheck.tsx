import { use, useEffect, useRef, useState } from "react";
import type { RunPoseGuard } from "../lib/poseguard/enrollment";
import { CaptureScreenContext } from "../AppShell";
import { captureFailure, INITIAL_CAPTURE_STATE, type CaptureState } from "../lib/selfie-capture";
import { CaptureProgressRing } from "./CaptureProgressRing";
import PoseGuardDiagnostics from "./PoseGuardDiagnostics";
import { ProcessingStatus, type EndAction } from "./ProcessingGlyph";
import { bumperGap, PoseTargetIndicator, targetDegrees } from "./PoseTargetIndicator";
import { logCaptureFailure } from "../lib/flow-logging";

// 11 units inside the ring viewBox, scaling with the aperture on narrow screens.
const APERTURE_INSET = "absolute inset-x-[calc(11/345.005*100%)] inset-y-[calc(11/481.637*100%)]";
// Reserve vertical space for camera guidance, controls, and safe-area padding.
const CAMERA_WIDTH = "w-[min(345px,max(60px,calc((100svh_-_292px)*0.7163)))]";
const RETRY = "min-h-12 max-w-45 flex-1 rounded-2xl bg-background-secondary p-3 text-[15px] text-foreground hover:bg-[#ededed]";

/** The camera screen: captures with PoseGuard and enrolls through `enroll`, ending on "You're all set". */
export default function SelfieCheck({ onClose, backLabel, enroll, endAction, onReturn }: {
  onClose: () => void;
  backLabel: string;
  enroll: RunPoseGuard;
  /** What the end screen offers besides the way back to the authenticator. */
  endAction?: EndAction;
  /** Returns to an authenticator that is already open; without it the end screen links to `/authenticator`. */
  onReturn?: () => void;
}) {
  const setCaptureActive = use(CaptureScreenContext);
  useEffect(() => { setCaptureActive(true); return () => setCaptureActive(false); }, [setCaptureActive]);
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  const enrollmentFinished = useRef(false);
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [attempt, setAttempt] = useState(0);
  // A completed enrollment ends on the processing screen's flood into "You're all set".
  const [allSet, setAllSet] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);

  const restart = () => {
    controller.current?.abort();
    setState(INITIAL_CAPTURE_STATE); setAttempt(value => value + 1);
  };
  const close = () => { controller.current?.abort(); onClose(); };

  useEffect(() => {
    const pause = () => {
      controller.current?.abort();
      setVisible(false);
      setState({ phase: "paused", title: "Your camera is off", hint: "Return to this page to start fresh.", progress: 0, cameraReady: false });
    };
    const visibility = () => {
      if (enrollmentFinished.current) return;
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
    void enroll(video.current, active.signal, next => {
      if (active.signal.aborted) return;
      setState(next);
    }).then(outcome => {
      if (active.signal.aborted) return;
      enrollmentFinished.current = outcome !== "pending";
      if (outcome === "completed") { setAllSet(true); return; }
      const title = {
        duplicate: "Face already enrolled",
        failed: "Enrollment failed",
        pending: "Enrollment pending",
      }[outcome];
      setState({ phase: outcome === "pending" ? "pending" : "complete", title, hint: "", progress: outcome === "pending" ? 1 : 0, cameraReady: false });
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
  }, [attempt, visible, enroll]);

  const complete = state.phase === "complete";
  // After the last capture the camera is off; processing shows its message alone, with a spinner.
  const processing = state.phase === "checking" && !state.cameraReady;
  // Live guidance is a pill over the camera; results, errors and processing stay as text above it.
  const pill = !processing && ["starting", "framing", "holding", "captured", "checking"].includes(state.phase);
  return <section className="group/selfie fixed inset-0 z-40 m-auto flex h-[100svh] w-full max-w-[393px] flex-col overflow-y-auto bg-white px-6 pt-[max(16px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]" data-state={state.phase} data-camera-ready={state.cameraReady} aria-label="Selfie capture">
    <header className="relative flex min-h-11 items-center justify-center">
      <button className="absolute left-0 grid size-11 place-items-center rounded-full bg-background-secondary text-foreground hover:bg-[#ededed]" type="button" aria-label={backLabel} onClick={close}><img className="size-6" src="/assets/figma/close.svg" alt="" /></button>
    </header>
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-2 text-center">
      <h1 className="sr-only">Selfie check</h1>
      {processing && <ProcessingStatus title={state.title} hint={state.hint} done={allSet} endAction={endAction} onReturn={onReturn} />}
      {!pill && !processing && <div role="status" aria-live="polite" aria-atomic="true" className="w-full text-center">
        <h2 className="text-[15px] leading-[1.3] text-foreground" data-testid="selfie-guidance">{state.title}</h2>
        {state.hint && <p className="mx-auto mt-1 max-w-[330px] text-[14px] leading-[1.35] text-foreground-secondary">{state.hint}</p>}
      </div>}
      <div className={`relative aspect-[345.005/481.637] ${CAMERA_WIDTH} max-w-full ${processing ? "hidden" : ""}`} data-testid="selfie-camera-stage">
        <div className={`${APERTURE_INSET} overflow-hidden rounded-[50%] bg-background-secondary`}>
          <video className={`size-full object-cover -scale-x-100 transition-opacity duration-250 ease-[ease] ${state.cameraReady ? "opacity-100" : "opacity-0"} ${complete ? "hidden" : ""}`} ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
        </div>
        <CaptureProgressRing progress={state.progress} gap={state.target ? bumperGap(state.target) : undefined} />
        {state.target && <PoseTargetIndicator target={state.target} aligned={state.phase === "holding"} />}
        {pill && <div role="status" aria-live="polite" aria-atomic="true" data-testid="selfie-guidance-pill"
          className="absolute top-[17%] left-1/2 flex max-w-[86%] -translate-x-1/2 items-center gap-2 rounded-xl bg-[rgb(31_31_31/78%)] px-3.5 py-[9px] text-[15px] leading-[1.3] text-white">
          <GuidanceIcon state={state} />
          <span data-testid="selfie-guidance">{state.title}</span>
        </div>}
      </div>
      {(complete || state.phase === "error" || state.phase === "pending") && <div className="flex w-full justify-center gap-2">
        {complete
          ? <button className={RETRY} type="button" onClick={close}>{backLabel}</button>
          : <button className={RETRY} type="button" onClick={restart}>{state.phase === "pending" ? "Check status" : "Try again"}</button>}
      </div>}
    </div>
    {import.meta.env.DEV && <PoseGuardDiagnostics />}
  </section>;
}

/** An arrow towards a target, a spinner only until the targets arrive, and nothing once the user is being guided. */
function GuidanceIcon({ state }: { state: CaptureState }) {
  if (state.target) {
    return <svg className="size-4 shrink-0" data-icon="arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ transform: `rotate(${targetDegrees(state.target)}deg)` }}>
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
  }
  if (state.phase !== "starting" && state.phase !== "checking") return null;
  return <svg className="size-4 shrink-0 motion-safe:animate-spin" data-icon="spinner" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.6" />
    <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>;
}
