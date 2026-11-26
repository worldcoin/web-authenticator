import { createContext, use, useLayoutEffect, useRef, type RefObject } from "react";
import { RequesterMark } from "./RequesterMark";

// Local capture returns to /demo for its result. Preserve the playhead through the route change.
export const DemoBadgeStart = createContext<RefObject<number | null> | null>(null);

const FRAME_MS = 1001 / 30;
const LAST_RING_FRAME = 33;
const BADGE_SETTLED_FRAME = 58;
// Clockwise reveal and alpha measured from the 105-frame Proof of Presence clip.
const dashOnsets = [12, 15, 17, 19, 21, 23, 25, 27, 30, 32, 35, 40];
const RING_START = dashOnsets[0]!;
const FIGURE_START = 34;
const ringOpacity = [.046, .060, .068, .079, .095, .112, .126, .143, .155, .178, .185, .202, .214, .223, .228, .232, .241, .269, .292, .332, .372, .423, .481, .534, .598, .647, .700, .745, .788, .822, .860, .886, .912, .929, .948, .959, .977, .984, .988, .993, .997];
const figureOpacity = [.009, .030, .054, .090, .136, .193, .254, .321, .399, .478, .560, .640, .714, .782, .839, .896, .945, .976, .991, 1];
const figureY = [12.5, 10.25, 8.25, 7, 6, 5, 4.25, 3.5, 3, 2.5, 2.25, 1.75, 1.5, 1.25, 1, .75, .75, .5, .25, .25, .25, 0];
const ringFrames = Array.from({ length: 105 }, (_, frame) => ({
  opacity: frame < RING_START ? 0 : ringOpacity[frame - RING_START] ?? 1,
  // Each dash and its gap occupy two units of the normalized circumference.
  strokeDasharray: dashOnsets.map(onset => frame >= onset ? "1 1" : "0 2").join(" "),
}));
const figureFrames = ringFrames.map((_, frame) => ({
  opacity: frame < FIGURE_START ? 0 : figureOpacity[frame - FIGURE_START] ?? 1,
  transform: `translateY(${figureY[Math.max(0, frame - FIGURE_START)] ?? 0}px)`,
}));
const ring = ringFrames.slice(0, LAST_RING_FRAME + 1);
const ringLoop = [...ring, ...ring.slice(1, -1).reverse()];

// The second clip spans 60 frames. Slide the pair together so the W enters on the left.
const frameNumbers = Array.from({ length: 60 }, (_, i) => i);
const entranceY = [24, 21.93, 18.26, 15.24, 12.53, 10.52, 8.77, 7.28, 6.01, 4.93, 3.99, 3.20, 2.50, 1.92, 1.43, 1.03, .70, .44, .25, .09, .02];
const entranceOpacity = [0, .003, .041, .118, .286, .467, .599, .692, .760, .815, .855, .891, .915, .943, .958, .976, .985, .992, .996];
const slideX = [.20, 1.05, 2.87, 5.90, 10.22, 15.21, 19.99, 24.02, 27.40, 30.21, 32.53, 34.52, 36.18, 37.54, 38.73, 39.72, 40.59, 41.26, 41.84, 42.31, 42.67, 42.95, 43.15, 43.28, 43.34];
const pairFrames = frameNumbers.map(i => ({ transform: `translateX(${i < 13 ? 0 : slideX[i - 13] ?? 43.5}px)` }));
const logoFrames = frameNumbers.map(i => ({
  transform: `translateY(${entranceY[i] ?? 0}px)`,
  opacity: entranceOpacity[i] ?? 1,
}));
const titleFrames = copyFrames(22);
const hintFrames = copyFrames(26);

export function PresenceBadge({ done, title, hint }: { done: boolean; title: string; hint?: string }) {
  const pair = useRef<HTMLSpanElement>(null);
  const logo = useRef<HTMLSpanElement>(null);
  const ringStroke = useRef<SVGCircleElement>(null);
  const figure = useRef<SVGGElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const description = useRef<HTMLParagraphElement>(null);
  const ownStart = useRef<number | null>(null);
  const start = use(DemoBadgeStart) ?? ownStart;
  const acceptedAt = useRef<number | null>(null);
  const hasHint = Boolean(hint);

  useLayoutEffect(() => {
    if (!ringStroke.current?.animate) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations: Animation[] = [];
    const stop = () => {
      for (const animation of animations.splice(0)) {
        void animation.finished.catch(() => {}); // Cancelling an active track rejects its completion promise.
        animation.cancel();
      }
    };
    const play = () => {
      stop();
      const now = performance.now();
      start.current ??= now;
      if (done) acceptedAt.current ??= now;
      else acceptedAt.current = null;
      if (motion.matches) return;

      const pendingTime = (acceptedAt.current ?? now) - start.current;
      const loopIndex = Math.floor(pendingTime / FRAME_MS) % ringLoop.length;
      const badgeFrame = Math.min(loopIndex, ringLoop.length - loopIndex);
      const playbackTime = done ? now - acceptedAt.current! + pendingTime % FRAME_MS : pendingTime;
      function track(element: Element | null, frames: Keyframe[], delay = 0, iterations = 1) {
        if (!element) return;
        // Duplicate the last key to hold each source frame for its entire sampling interval.
        const keys = [...frames, frames[frames.length - 1]!].map(frame => ({ ...frame, easing: "steps(1, end)" }));
        const animation = element.animate(keys, { duration: frames.length * FRAME_MS, iterations, delay, fill: "both" });
        animation.currentTime = playbackTime;
        animations.push(animation);
      }
      if (!done) {
        track(ringStroke.current, ringLoop, 0, Infinity);
        return;
      }
      track(ringStroke.current, ringFrames.slice(badgeFrame));
      track(figure.current, figureFrames.slice(badgeFrame));
      // Start the requester clip on the badge's settled hold, continuing from the visible ring frame.
      const handoff = (BADGE_SETTLED_FRAME - badgeFrame) * FRAME_MS;
      track(pair.current, pairFrames, handoff);
      track(logo.current, logoFrames, handoff);
      track(heading.current, titleFrames, handoff);
      track(description.current, hintFrames, handoff);
    };
    play();
    const preferenceChanged = () => { if (done) stop(); else play(); };
    motion.addEventListener("change", preferenceChanged);
    return () => { stop(); motion.removeEventListener("change", preferenceChanged); };
  }, [done, start, hasHint]);

  return <>
    <span aria-hidden="true" className="pointer-events-none absolute top-[calc(var(--experience-height)/2-26px)] left-1/2" data-testid="presence-badge" data-result={done ? "accepted" : "pending"}>
      <span ref={pair} className="absolute top-0 left-0" style={done ? pairFrames[59] : undefined}>
        <svg className="absolute -top-12 -left-12 size-24" viewBox="0 0 96 96" fill="#9c9c9c" aria-hidden="true">
          <circle ref={ringStroke} cx="48" cy="48" r="37.8" pathLength="24" fill="none" stroke="#9c9c9c"
            strokeWidth="8" transform="rotate(-97.5 48 48)" style={ringFrames[done ? BADGE_SETTLED_FRAME : LAST_RING_FRAME]} />
          {done && <g ref={figure}>
            <circle cx="48.5" cy="28.57" r="6.02" />
            <path d="M30.1 32.59 48.5 44.77l18.4-12.18 4.3 6.54-18.77 12.16V72.5h-7.86V51.29L25.8 39.13Z" />
          </g>}
        </svg>
        {done && <span ref={logo} className="absolute -top-10 -left-[127px] block size-20 rounded-[20px]"><RequesterMark /></span>}
      </span>
    </span>
    <div role="status" aria-live="polite" aria-atomic="true" className="mt-[calc(var(--experience-height)/2+61px)] w-full text-center">
      <h2 ref={heading} className={done ? "text-h2" : "text-h4"} data-testid="selfie-guidance">{title}</h2>
      {hint && <p ref={description} className="mx-auto mt-3 max-w-[260px] text-b1 text-foreground-secondary">{hint}</p>}
    </div>
  </>;
}

function copyFrames(first: number) {
  // The description enters four frames after the heading with the same lift and opacity curve.
  const opacity = [0, .008, .026, .058, .104, .154, .215, .280, .351, .425, .499, .574, .648, .717, .785, .844, .896, .939, .974, .993, 1];
  const lift = [18, 13.66, 11.08, 8.99, 7.48, 6.17, 5.10, 4.19, 3.42, 2.75, 2.19, 1.71, 1.32, .97, .69, .47, .29, .16, .05, .01, 0];
  return frameNumbers.map(frame => {
    const i = Math.max(0, Math.min(frame - first, opacity.length - 1));
    return { opacity: opacity[i], transform: `translateY(${lift[i]}px)` };
  });
}
