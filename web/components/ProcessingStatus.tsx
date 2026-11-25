import { useLayoutEffect, useRef, useState } from "react";
import { AllSet, type EndAction } from "./AllSet";
import { Flood } from "./Flood";
import { CLOSE_MS, ProcessingGlyph } from "./ProcessingGlyph";

export type { EndAction };

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
      <h2 className="text-h4 text-foreground-primary" data-testid="selfie-guidance">{title}</h2>
      {hint && <p className="mx-auto mt-1 max-w-[330px] text-b2 text-foreground-secondary">{hint}</p>}
    </div>
    {flood && <Flood {...flood} onDone={() => setAllSet(true)} />}
  </>;
}
