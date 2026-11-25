import { useEffect, useEffectEvent, useRef } from "react";
import { GLYPH_PX, STROKE_PX } from "./ProcessingGlyph";

const FLOOD_MS = 700;

/**
 * The closed ring as two discs: the blue one grows over the screen while the white one inside it shrinks away.
 * Both animate only `transform`, so frames run on the compositor with no layout, paint or script. The blue disc
 * is laid out at its final size and starts scaled down, so it is rasterised once, crisp, at the size it ends.
 */
export function Flood({ x, y, diameter, onDone }: { x: number; y: number; diameter: number; onDone: () => void }) {
  const blue = useRef<HTMLDivElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  // The latest callback, so a parent re-render does not restart the animation.
  const finish = useEffectEvent(onDone);
  useEffect(() => {
    const options: KeyframeAnimationOptions = { duration: FLOOD_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" };
    if (typeof blue.current?.animate !== "function") { finish(); return; }
    const outward = blue.current.animate([{ transform: `scale(${GLYPH_PX / diameter})` }, { transform: "scale(1)" }], options);
    const inward = hole.current!.animate([{ transform: "scale(1)" }, { transform: "scale(0)" }], options);
    let live = true;
    void Promise.all([outward.finished, inward.finished]).then(() => { if (live) finish(); }, () => {});
    return () => { live = false; outward.cancel(); inward.cancel(); };
  }, [diameter]);
  const disc = (size: number) => ({ left: x - size / 2, top: y - size / 2, width: size, height: size });
  return <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true" data-testid="completion-flood">
    <div ref={blue} className="absolute rounded-full bg-accent-blue will-change-transform" style={{ ...disc(diameter), transform: `scale(${GLYPH_PX / diameter})` }} />
    <div ref={hole} className="absolute rounded-full bg-surface-page will-change-transform" style={disc(GLYPH_PX - 2 * STROKE_PX)} />
  </div>;
}
