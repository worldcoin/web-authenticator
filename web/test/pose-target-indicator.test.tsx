import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ringPoint } from "../components/CaptureProgressRing";
import { CHEVRON_OUTSET, PoseTargetIndicator } from "../components/PoseTargetIndicator";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
// Let React flush the last unmount's scheduled effects before the DOM goes away.
afterAll(async () => { await new Promise(resolve => setTimeout(resolve, 0)); await GlobalRegistrator.unregister(); });
afterEach(cleanup);

// Browser pose: positive yaw turns left, negative pitch looks up.
const LEFT = { pitch: 0, yaw: 30 };
const UP_AND_RIGHT = { pitch: -15, yaw: -15 };
const angle = () => Number(document.querySelector<SVGElement>("[data-testid=pose-target-indicator]")!.dataset.angle);

test("turns the short way round to the next target", async () => {
  const view = render(<PoseTargetIndicator target={LEFT} aligned={false} />);
  expect(angle()).toBe(270);
  view.rerender(<PoseTargetIndicator target={UP_AND_RIGHT} aligned={false} />);
  // 270° to 45° goes clockwise through the top (+135°), never back through 180°.
  await waitFor(() => expect(angle() > 270 || angle() < 45).toBe(true));
  await waitFor(() => expect(angle()).toBe(45), { timeout: 1_000 });
});

test("jumps to the next target when the user prefers reduced motion", () => {
  const original = window.matchMedia;
  window.matchMedia = (query: string) => ({ matches: query.includes("reduce"), media: query } as MediaQueryList);
  try {
    const view = render(<PoseTargetIndicator target={LEFT} aligned={false} />);
    view.rerender(<PoseTargetIndicator target={UP_AND_RIGHT} aligned={false} />);
    expect(angle()).toBe(45);
  } finally {
    window.matchMedia = original;
  }
});

test("places the chevron outside the dot ring along the target direction", () => {
  for (const degrees of [0, 45, 90, 180, 270]) {
    const [rx, ry] = ringPoint(degrees);
    const [cx, cy] = ringPoint(degrees, CHEVRON_OUTSET);
    expect(Math.hypot(cx - rx, cy - ry)).toBeCloseTo(CHEVRON_OUTSET, 6);
  }
});
