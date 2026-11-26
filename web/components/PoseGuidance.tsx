import { useLayoutEffect, useRef } from "react";
import { Icon } from "../design/Icon";
import { Spinner } from "../design/Spinner";
import type { CaptureState } from "../lib/selfie-capture";
import { targetDegrees } from "./PoseTargetIndicator";

export function PoseGuidance({ state }: { state: CaptureState }) {
  const pill = useRef<HTMLDivElement>(null);
  const background = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ width: number; step?: number }>(undefined);
  const step = state.poseStep?.index;
  const direction = state.target ? targetDegrees(state.target) : undefined;

  useLayoutEffect(() => {
    const surface = background.current!;
    const width = pill.current!.getBoundingClientRect().width;
    const from = previous.current;
    previous.current = { width, step };
    if (!from || step === undefined || from.step === step || from.width === width ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = surface.animate?.([{ width: `${from.width}px` }, { width: `${width}px` }], {
      duration: 160, easing: getComputedStyle(surface).getPropertyValue("--ease-handoff").trim(),
    });
    return () => animation?.cancel();
  }, [step, state.title, direction]);

  return <div ref={pill} role="status" aria-live="polite" aria-atomic="true" data-testid="selfie-guidance-pill"
    className="pose-guidance absolute top-[17%] left-1/2 isolate flex w-max max-w-[86%] -translate-x-1/2 items-center gap-2 px-3.5 py-[9px] text-b2 text-foreground-inverse">
    <span ref={background} aria-hidden="true" className="absolute inset-y-0 left-1/2 -z-1 w-full -translate-x-1/2 rounded-xl bg-background-inverse/78" />
    <GuidanceIcon key={step} state={state} />
    <span data-testid="selfie-guidance">{state.title}</span>
  </div>;
}

/** An arrow towards a target, a spinner only until the targets arrive, and nothing once the user is being guided. */
function GuidanceIcon({ state }: { state: CaptureState }) {
  if (state.target) {
    // The wrapper turns the arrow, so the Nucleus icon keeps its own markup.
    return <span className="flex size-4 shrink-0 motion-safe:animate-arrow-focus" data-testid="guidance-arrow" style={{ transform: `rotate(${targetDegrees(state.target)}deg)` }}>
      <Icon icon="arrow-up" className="size-4" />
    </span>;
  }
  if (state.phase !== "starting" && state.phase !== "checking") return null;
  return <Spinner className="size-4 shrink-0" />;
}
