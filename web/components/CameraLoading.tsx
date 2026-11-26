import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";

const TURN = 2 * Math.PI;
const LOOP_MS = 9_600;
const COLLAPSE_MS = 960;
const OPEN_MS = 1_040;

// Angles sampled around one revolution, in equal 400 ms intervals.
const ANGLES = [10, 20, 30, 42, 55, 70, 87, 110, 139, 176, 210, 235, 254, 269, 282, 294, 304, 314, 323, 331, 338, 346, 354, 362, 370];
// Silhouette and camera blend sampled in equal time intervals from the 50 fps reference.
const ORBIT = [1, 1, 1, .99, .95, .90, .79, .60, .42, .26, 0];
const DOT_RADIUS = [8.2, 8.2, 8.2, 8.2, 8.2, 8.4, 8.6, 9, 9.6, 10.7, 21];
const PULSE_PHASE = [0, 20, 20, 40, 0, 20, 40, 0, 20, 40, 0, 20, 40];
const OPEN_X = [0, .006, .048, .145, .422, .72, .866, .94, .977, .996, 1];
const OPEN_Y = [0, .013, .057, .16, .43, .72, .865, .94, .977, .996, 1];
const CAMERA_BLEND = [0, 0, 0, 0, .23, .59, .88, 1, 1, 1, 1];

export function CameraLoading({ ready, aperture }: { ready: boolean; aperture: RefObject<HTMLDivElement | null> }) {
  const mask = useId();
  const svg = useRef<SVGSVGElement>(null);
  const started = useRef<number | null>(null);
  const [frame, setFrame] = useState({ elapsed: 0, exit: 0, still: false });
  const [done, setDone] = useState(false);
  const [bounds, setBounds] = useState({ width: 234, height: 506, cx: 117, cy: 253, rx: 106, ry: 133 });

  useLayoutEffect(() => {
    const surface = svg.current;
    const camera = aperture.current;
    if (!surface || !camera || done) return;
    const measure = () => {
      const area = surface.getBoundingClientRect();
      const oval = camera.getBoundingClientRect();
      setBounds({ width: area.width, height: area.height, cx: oval.x + oval.width / 2 - area.x,
        cy: oval.y + oval.height / 2 - area.y, rx: oval.width / 2, ry: oval.height / 2 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    observer.observe(camera);
    return () => observer.disconnect();
  }, [aperture, ready, done]);

  useLayoutEffect(() => {
    if (done) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const now = performance.now();
    started.current ??= now;
    const start = started.current;
    // A warm camera can open in less time than the dots would take to merge.
    if (ready && (now - start < COLLAPSE_MS || motion.matches)) {
      setDone(true);
      return;
    }
    let raf = 0;
    const tick = (time: number) => {
      const exit = ready ? Math.max(0, time - now) : 0;
      if (ready && (exit >= COLLAPSE_MS + OPEN_MS || motion.matches)) {
        setDone(true);
        return;
      }
      setFrame({ elapsed: time - start, exit, still: motion.matches });
      if (!motion.matches) raf = requestAnimationFrame(tick);
    };
    const refresh = () => { cancelAnimationFrame(raf); tick(performance.now()); };
    refresh();
    motion.addEventListener("change", refresh);
    return () => { cancelAnimationFrame(raf); motion.removeEventListener("change", refresh); };
  }, [ready, done]);

  if (done) return null;
  const { width, height, cx, cy, rx, ry } = bounds;
  const scale = Math.min(width / 234, height / 506);
  const elapsed = frame.still ? 0 : frame.elapsed;
  const collapse = Math.min(1, frame.exit / COLLAPSE_MS);
  const open = Math.max(0, (frame.exit - COLLAPSE_MS) / OPEN_MS);
  const orbitTime = elapsed - frame.exit;
  const radius = (45.35 + 7.45 * Math.cos(TURN * (orbitTime - 420) / 4_780)) * sample(ORBIT, collapse);
  const angle = sample(ANGLES, (elapsed % LOOP_MS) / LOOP_MS) * Math.PI / 180;
  const disc = 21 * scale;
  const x = sample(OPEN_X, open);
  const y = sample(OPEN_Y, open);
  const ellipse = { cx: width / 2 + (cx - width / 2) * x, cy: height / 2 + (cy - height / 2) * y,
    rx: disc + (rx - disc) * x, ry: disc + (ry - disc) * y };

  return <svg ref={svg} aria-hidden="true" data-testid="camera-loading" className="pointer-events-none absolute inset-0 size-full text-accent-blue">
    <defs><mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
      <rect width="100%" height="100%" fill="white" />
      {collapse === 1 && <ellipse {...ellipse} fill="black" />}
    </mask></defs>
    <rect width="100%" height="100%" fill="var(--color-surface-page)" mask={`url(#${mask})`} opacity={1 - Math.max(0, (open - .75) / .25)} />
    {collapse === 1 ? <ellipse {...ellipse} fill="currentColor" opacity={1 - sample(CAMERA_BLEND, open)} /> :
      PULSE_PHASE.map((phase, index) => {
        const theta = angle + TURN * index / PULSE_PHASE.length;
        const pulse = (.5 + .5 * Math.cos(TURN * (elapsed / 20 + phase - 17) / 60)) * .45;
        return <circle key={index} cx={width / 2 + scale * radius * Math.sin(theta)}
          cy={height / 2 - scale * radius * Math.cos(theta)} r={scale * sample(DOT_RADIUS, collapse)}
          fill="currentColor" opacity={1 - pulse * Math.min(1, (1 - collapse) * 4)} />;
      })}
  </svg>;
}

function sample(values: number[], fraction: number) {
  const position = Math.max(0, Math.min(1, fraction)) * (values.length - 1);
  const index = Math.floor(position);
  const from = values[index]!;
  return from + ((values[index + 1] ?? from) - from) * (position - index);
}
