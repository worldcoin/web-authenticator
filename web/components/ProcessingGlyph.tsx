import type { Ref } from "react";

// The World ID workboard's verifying glyph (Figma 5132:135038): a person mark inside a ring whose
// blue arc turns as a spinner. Under reduced motion it holds still, as drawn.
const RADIUS = 42.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Figma's arc runs from the top to about 100° clockwise.
const ARC = CIRCUMFERENCE * 100 / 360;
/** How long the arc takes to close into a full ring once processing is done. */
export const CLOSE_MS = 250;
// The glyph's ring, in CSS px: 88 px across, its stroke 3 px wide.
export const GLYPH_PX = 88;
export const STROKE_PX = 3;

export function ProcessingGlyph({ ref, done }: { ref: Ref<SVGSVGElement>; done: boolean }) {
  return <svg ref={ref} className="size-22 shrink-0" data-testid="processing-glyph" data-done={done} viewBox="0 0 88 88" fill="none" aria-hidden="true">
    <g className="stroke-foreground-primary" strokeWidth="3">
      <path d="M44 57.51a13.5 13.5 0 1 0 0-27.01 13.5 13.5 0 0 0 0 27.01Z" />
      <path d="M44 45.44a4.47 4.47 0 1 0 0-8.94 4.47 4.47 0 0 0 0 8.94Z" />
      <path d="M34.64 53.84c1.1-1.84 3.17-3.08 5.53-3.08h7.66c2.2 0 4.15 1.08 5.29 2.72" />
    </g>
    <circle className="stroke-stroke-secondary" cx="44" cy="44" r={RADIUS} strokeWidth="3" />
    <g className={done ? "" : "motion-safe:animate-spin"} style={{ transformOrigin: "44px 44px" }}>
      <circle className="stroke-accent-blue" cx="44" cy="44" r={RADIUS} strokeWidth="3" transform="rotate(-90 44 44)"
        strokeDasharray={done ? `${CIRCUMFERENCE} 0` : `${ARC} ${CIRCUMFERENCE}`} style={{ transition: `stroke-dasharray ${CLOSE_MS}ms ease-out` }} />
    </g>
  </svg>;
}
