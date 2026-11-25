// The World ID workboard's verifying glyph (Figma 5132:135038): a person mark inside a ring whose
// blue arc turns as a spinner. Under reduced motion it holds still, as drawn.
const RADIUS = 42.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Figma's arc runs from the top to about 100° clockwise.
const ARC = CIRCUMFERENCE * 100 / 360;

export function ProcessingGlyph() {
  return <svg className="size-22 shrink-0" data-testid="processing-glyph" viewBox="0 0 88 88" fill="none" aria-hidden="true">
    <path d="M44 57.51a13.5 13.5 0 1 0 0-27.01 13.5 13.5 0 0 0 0 27.01Z" stroke="#1f1f1f" strokeWidth="3" />
    <path d="M44 45.44a4.47 4.47 0 1 0 0-8.94 4.47 4.47 0 0 0 0 8.94Z" stroke="#1f1f1f" strokeWidth="3" />
    <path d="M34.64 53.84c1.1-1.84 3.17-3.08 5.53-3.08h7.66c2.2 0 4.15 1.08 5.29 2.72" stroke="#1f1f1f" strokeWidth="3" />
    <circle cx="44" cy="44" r={RADIUS} stroke="#f1f1f1" strokeWidth="3" />
    <g className="motion-safe:animate-spin" style={{ transformOrigin: "44px 44px" }}>
      <circle cx="44" cy="44" r={RADIUS} stroke="currentColor" className="text-accent" strokeWidth="3"
        strokeDasharray={`${ARC} ${CIRCUMFERENCE}`} transform="rotate(-90 44 44)" />
    </g>
  </svg>;
}
