const WIDTH = 345.005;
const HEIGHT = 481.637;
const DOT_COUNT = 64;
const SURFACE_INSET = 11;
const RING_GAP = 8;

// Match the camera ellipse, offset along its normal for a constant edge gap.
// Equal angles crowd dots near the tips, so distribute them by arc length instead.
const samples = Array.from({ length: 1025 }, (_, index) => {
  const angle = index / 1024 * Math.PI * 2;
  const rx = WIDTH / 2 - SURFACE_INSET;
  const ry = HEIGHT / 2 - SURFACE_INSET;
  const nx = Math.sin(angle) / rx;
  const ny = -Math.cos(angle) / ry;
  const normal = Math.hypot(nx, ny);
  return { x: WIDTH / 2 + rx * Math.sin(angle) + RING_GAP * nx / normal,
    y: HEIGHT / 2 - ry * Math.cos(angle) + RING_GAP * ny / normal, length: 0 };
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
  return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
});

// The completion stroke follows the same contour as the dots.
const BORDER_PATH = samples.filter((_, index) => index % 4 === 0)
  .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(" ") + " Z";

export function CaptureProgressRing({ progress }: { progress: number }) {
  const filled = Math.floor(Math.max(0, Math.min(1, progress)) * DOT_COUNT);
  // On completion the dots give way to a border that the capture-border stage animates.
  return <svg className="pointer-events-none absolute top-0 left-0 h-auto w-[345.005px] max-w-full" data-testid="selfie-design-ring" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} fill="none" aria-hidden="true">
    {DOTS.map(({ x, y }, index) => <circle className="fill-[#e3e3e3] data-[filled=true]:fill-[#d4af37] group-data-[transitioning=true]/selfie:invisible" key={index} cx={x} cy={y} r="2.94866" data-filled={index < filled} />)}
    <path className="hidden group-data-[transitioning=true]/selfie:block group-data-[stage=capture-border]/sequence:motion-safe:animate-selfie-border-complete" data-testid="selfie-completion-border" d={BORDER_PATH} pathLength={DOT_COUNT}
      stroke="#28a86b" strokeWidth="5.89732" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 0" strokeDashoffset="0.5" />
  </svg>;
}
