import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type Ref } from "react";
import { actions, primaryAction } from "./styles";

// The shared link style rings focus in the accent, which would vanish on the blue end screen.
const END_LINK = "block text-center focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-white";

// The World ID workboard's verifying glyph (Figma 5132:135038): a person mark inside a ring whose
// blue arc turns as a spinner. Under reduced motion it holds still, as drawn.
const RADIUS = 42.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Figma's arc runs from the top to about 100° clockwise.
const ARC = CIRCUMFERENCE * 100 / 360;
const CLOSE_MS = 250;
const FLOOD_MS = 700;
// The glyph's ring, in CSS px: 88 px across, its stroke 3 px wide.
const GLYPH_PX = 88;
const STROKE_PX = 3;

/** A way on from the end screen: a link back to the RP. */
export type EndAction = { label: string; href: string };

/**
 * The processing screen after capture. When `done`, the arc closes and the ring floods the screen
 * blue (growing outward and filling inward at once) into the end screen, which says only "You're all set".
 */
export function ProcessingStatus({ title, hint, done = false, endAction }: { title: string; hint?: string; done?: boolean; endAction?: EndAction }) {
  const glyph = useRef<SVGSVGElement>(null);
  const [flood, setFlood] = useState<{ x: number; y: number; diameter: number }>();
  const [allSet, setAllSet] = useState(false);

  useLayoutEffect(() => {
    if (!done) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !glyph.current) { setAllSet(true); return; }
    const timer = setTimeout(() => {
      const box = glyph.current!.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      // Far enough for the disc to cover the viewport's farthest corner.
      const reach = Math.max(Math.hypot(x, y), Math.hypot(innerWidth - x, y), Math.hypot(x, innerHeight - y), Math.hypot(innerWidth - x, innerHeight - y));
      setFlood({ x, y, diameter: 2 * Math.ceil(reach) + 2 });
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  if (allSet) return <AllSet action={endAction} />;
  return <>
    <ProcessingGlyph ref={glyph} done={done} />
    <div role="status" aria-live="polite" aria-atomic="true" className={`mt-4 w-full text-center transition-opacity duration-200 ${flood ? "opacity-0" : ""}`}>
      <h2 className="text-[22px] leading-[1.2] tracking-[-0.3px] text-foreground" data-testid="selfie-guidance">{title}</h2>
      {hint && <p className="mx-auto mt-1 max-w-[330px] text-[14px] leading-[1.35] text-foreground-secondary">{hint}</p>}
    </div>
    {flood && <Flood {...flood} onDone={() => setAllSet(true)} />}
  </>;
}

function ProcessingGlyph({ ref, done }: { ref: Ref<SVGSVGElement>; done: boolean }) {
  return <svg ref={ref} className="size-22 shrink-0" data-testid="processing-glyph" data-done={done} viewBox="0 0 88 88" fill="none" aria-hidden="true">
    <path d="M44 57.51a13.5 13.5 0 1 0 0-27.01 13.5 13.5 0 0 0 0 27.01Z" stroke="#1f1f1f" strokeWidth="3" />
    <path d="M44 45.44a4.47 4.47 0 1 0 0-8.94 4.47 4.47 0 0 0 0 8.94Z" stroke="#1f1f1f" strokeWidth="3" />
    <path d="M34.64 53.84c1.1-1.84 3.17-3.08 5.53-3.08h7.66c2.2 0 4.15 1.08 5.29 2.72" stroke="#1f1f1f" strokeWidth="3" />
    <circle cx="44" cy="44" r={RADIUS} stroke="#f1f1f1" strokeWidth="3" />
    <g className={done ? "" : "motion-safe:animate-spin"} style={{ transformOrigin: "44px 44px" }}>
      <circle cx="44" cy="44" r={RADIUS} stroke="currentColor" className="text-accent" strokeWidth="3" transform="rotate(-90 44 44)"
        strokeDasharray={done ? `${CIRCUMFERENCE} 0` : `${ARC} ${CIRCUMFERENCE}`} style={{ transition: `stroke-dasharray ${CLOSE_MS}ms ease-out` }} />
    </g>
  </svg>;
}

/**
 * The closed ring as two discs: the blue one grows over the screen while the white one inside it shrinks away.
 * Both animate only `transform`, so frames run on the compositor with no layout, paint or script. The blue disc
 * is laid out at its final size and starts scaled down, so it is rasterised once, crisp, at the size it ends.
 */
function Flood({ x, y, diameter, onDone }: { x: number; y: number; diameter: number; onDone: () => void }) {
  const blue = useRef<HTMLDivElement>(null);
  const white = useRef<HTMLDivElement>(null);
  // The latest callback, so a parent re-render does not restart the animation.
  const finish = useEffectEvent(onDone);
  useEffect(() => {
    const options: KeyframeAnimationOptions = { duration: FLOOD_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" };
    if (typeof blue.current?.animate !== "function") { finish(); return; }
    const outward = blue.current.animate([{ transform: `scale(${GLYPH_PX / diameter})` }, { transform: "scale(1)" }], options);
    const inward = white.current!.animate([{ transform: "scale(1)" }, { transform: "scale(0)" }], options);
    let live = true;
    void Promise.all([outward.finished, inward.finished]).then(() => { if (live) finish(); }, () => {});
    return () => { live = false; outward.cancel(); inward.cancel(); };
  }, [diameter]);
  const disc = (size: number) => ({ left: x - size / 2, top: y - size / 2, width: size, height: size });
  return <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true" data-testid="completion-flood">
    <div ref={blue} className="absolute rounded-full bg-accent will-change-transform" style={{ ...disc(diameter), transform: `scale(${GLYPH_PX / diameter})` }} />
    <div ref={white} className="absolute rounded-full bg-white will-change-transform" style={disc(GLYPH_PX - 2 * STROKE_PX)} />
  </div>;
}

/**
 * The end screen: the whole screen blue, "You're all set" and "You can close this tab" together, and a black
 * button back to the authenticator at the bottom (with the RP's return link under it if it gave one).
 */
function AllSet({ action }: { action?: EndAction }) {
  return <div className="fixed inset-0 z-50 flex flex-col items-center bg-accent px-6 pt-[max(16px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))] text-center text-white" data-testid="all-set">
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 motion-safe:animate-completion-in">
      <h2 className="text-[28px] leading-[1.2] tracking-[-0.4px]">You’re all set</h2>
      <p className="text-[15px] text-white/80">You can close this tab</p>
    </div>
    <div className={`${actions} motion-safe:animate-completion-in`}>
      <a className={`${primaryAction} ${END_LINK}`} href="/authenticator">Return to authenticator</a>
      {action && <a className={`${END_LINK} min-h-11 content-center text-[15px] text-white underline underline-offset-3`} href={action.href}>{action.label}</a>}
    </div>
  </div>;
}
