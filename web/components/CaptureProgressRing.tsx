const WIDTH = 345.005;
const HEIGHT = 481.637;
const DOT_COUNT = 64;
const SURFACE_INSET = 11;
const RING_GAP = 8;

/** The ring's SVG coordinate space; overlays use it to line up with the dots. */
export const RING_VIEW_BOX = `0 0 ${WIDTH} ${HEIGHT}`;

// Equal angles crowd dots near the tips, so distribute them by arc length instead.
const samples = Array.from({ length: 1025 }, (_, index) => {
  const [x, y] = ringPoint(index / 1024 * 360);
  return { x, y, length: 0 };
});
for (let index = 1; index < samples.length; index++) {
  const previous = samples[index - 1]!;
  const point = samples[index]!;
  point.length = previous.length + Math.hypot(point.x - previous.x, point.y - previous.y);
}
const perimeter = samples[samples.length - 1]!.length;
let segment = 1;
const DOTS = Array.from({ length: DOT_COUNT }, (_, index) => {
  const distance = index / DOT_COUNT * perimeter;
  while (samples[segment]!.length < distance) segment++;
  const start = samples[segment - 1]!;
  const end = samples[segment]!;
  const fraction = (distance - start.length) / (end.length - start.length);
  return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction,
    degrees: (segment - 1 + fraction) / 1024 * 360 };
});

// The completion stroke follows the same contour as the dots.
const BORDER_PATH = samples.filter((_, index) => index % 4 === 0)
  .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(" ") + " Z";

/** Dots within `gap` are left out so an overlay drawn there, such as the PoseGuard bumper, covers clean ring. */
export function CaptureProgressRing({ progress, gap }: { progress: number; gap?: { degrees: number; span: number } }) {
  const filled = Math.floor(Math.max(0, Math.min(1, progress)) * DOT_COUNT);
  const covered = (degrees: number) => !!gap && Math.abs(((degrees - gap.degrees + 540) % 360) - 180) <= gap.span / 2;
  // On completion the dots give way to a border that the capture-border stage animates.
  return <svg className="pointer-events-none absolute top-0 left-0 h-auto w-[345.005px] max-w-full text-accent" data-testid="selfie-design-ring" viewBox={RING_VIEW_BOX} fill="none" aria-hidden="true">
    {DOTS.map(({ x, y, degrees }, index) => covered(degrees) ? null : <circle className="group-data-[transitioning=true]/selfie:invisible" fill={index < filled ? "currentColor" : "#e3e3e3"} key={index} cx={x} cy={y} r="2.94866" data-filled={index < filled} />)}
    <path className="hidden group-data-[transitioning=true]/selfie:block group-data-[stage=capture-border]/sequence:motion-safe:animate-selfie-border-complete" data-testid="selfie-completion-border" d={BORDER_PATH} pathLength={DOT_COUNT}
      stroke="#28a86b" strokeWidth="5.89732" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 0" strokeDashoffset="0.5" />
  </svg>;
}

/** A point on the ring at `degrees` clockwise from the top: the camera ellipse, offset along its normal for a constant edge gap. */
export function ringPoint(degrees: number): [x: number, y: number] {
  const angle = degrees * Math.PI / 180;
  const rx = WIDTH / 2 - SURFACE_INSET;
  const ry = HEIGHT / 2 - SURFACE_INSET;
  const nx = Math.sin(angle) / rx;
  const ny = -Math.cos(angle) / ry;
  const gap = RING_GAP / Math.hypot(nx, ny);
  return [WIDTH / 2 + rx * Math.sin(angle) + gap * nx, HEIGHT / 2 - ry * Math.cos(angle) + gap * ny];
}

/** The ring's outward direction at `degrees`, clockwise from the top; on the tall ellipse it leans towards the sides. */
export function ringNormalDegrees(degrees: number): number {
  const angle = degrees * Math.PI / 180;
  const nx = Math.sin(angle) / (WIDTH / 2 - SURFACE_INSET);
  const ny = Math.cos(angle) / (HEIGHT / 2 - SURFACE_INSET);
  return (Math.atan2(nx, ny) * 180 / Math.PI + 360) % 360;
}
