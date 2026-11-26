import { useEffect, useState } from "react";

const TURN = 2 * Math.PI;
const LOOP_MS = 9_600;

// Angles sampled around one revolution, in equal 400 ms intervals.
const ANGLES = [10, 20, 30, 42, 55, 70, 87, 110, 139, 176, 210, 235, 254, 269, 282, 294, 304, 314, 323, 331, 338, 346, 354, 362, 370];
const PULSE_PHASE = [0, 20, 20, 40, 0, 20, 40, 0, 20, 40, 0, 20, 40];

export function CameraLoading() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    let raf = 0;
    const tick = (time: number) => {
      setElapsed(Math.max(0, time - start));
      raf = requestAnimationFrame(tick);
    };
    const refresh = () => {
      cancelAnimationFrame(raf);
      if (motion.matches) setElapsed(0);
      else raf = requestAnimationFrame(tick);
    };
    refresh();
    motion.addEventListener("change", refresh);
    return () => { cancelAnimationFrame(raf); motion.removeEventListener("change", refresh); };
  }, []);

  const radius = 45.35 + 7.45 * Math.cos(TURN * (elapsed - 420) / 4_780);
  const angle = orbitAngle(elapsed);
  return <svg aria-hidden="true" data-testid="camera-loading" viewBox="-117 -253 234 506"
    className="pointer-events-none absolute inset-0 size-full bg-surface-page text-accent-blue">
    {PULSE_PHASE.map((phase, index) => {
      const theta = angle + TURN * index / PULSE_PHASE.length;
      const pulse = (.5 + .5 * Math.cos(TURN * (elapsed / 20 + phase - 17) / 60)) * .45;
      return <circle key={index} cx={radius * Math.sin(theta)} cy={-radius * Math.cos(theta)}
        r="8.2" fill="currentColor" opacity={1 - pulse} />;
    })}
  </svg>;
}

function orbitAngle(elapsed: number) {
  const position = (elapsed % LOOP_MS) / LOOP_MS * (ANGLES.length - 1);
  const index = Math.floor(position);
  const from = ANGLES[index]!;
  const degrees = from + (ANGLES[index + 1]! - from) * (position - index);
  return degrees * Math.PI / 180;
}
