import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { CaptureProgressRing, ringNormalDegrees, ringPoint } from "../components/CaptureProgressRing";
import { bumperGap, PoseTargetIndicator } from "../components/PoseTargetIndicator";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
// Let React flush the last unmount's scheduled effects before the DOM goes away.
afterAll(async () => { await new Promise(resolve => setTimeout(resolve, 0)); await GlobalRegistrator.unregister(); });
afterEach(cleanup);

// Browser pose: positive yaw turns left, negative pitch looks up.
const LEFT = { pitch: 0, yaw: 30 };
const UP_AND_RIGHT = { pitch: -15, yaw: -15 };
const angle = () => Number(document.querySelector<SVGElement>("[data-testid=pose-target-indicator]")!.dataset.angle);

test("appears straight at each new target without turning through the ones between", () => {
  const view = render(<PoseTargetIndicator target={LEFT} aligned={false} />);
  expect(angle()).toBe(270);
  view.rerender(<PoseTargetIndicator target={UP_AND_RIGHT} aligned={false} />);
  expect(angle()).toBe(45);
});

test("puts the chevron on the ring at the target, pointing straight out from it", () => {
  render(<PoseTargetIndicator target={UP_AND_RIGHT} aligned={false} />);
  const [x, y] = ringPoint(45);
  expect(document.querySelectorAll("[data-testid=pose-target-indicator] path")[1]!.getAttribute("transform"))
    .toBe(`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ringNormalDegrees(45).toFixed(1)})`);
  // The tall ellipse's outward direction leans towards the side at 45°; it matches the target only at the axes.
  expect(ringNormalDegrees(45)).toBeGreaterThan(50);
  for (const axis of [0, 90, 180, 270]) expect(ringNormalDegrees(axis)).toBeCloseTo(axis, 6);
});

test("the ring leaves out exactly the dots under the bumper", () => {
  const view = render(<CaptureProgressRing progress={0} />);
  const all = [...document.querySelectorAll("[data-testid=selfie-design-ring] circle")].map(dot => dot.getAttribute("cx") + "," + dot.getAttribute("cy"));
  view.rerender(<CaptureProgressRing progress={0} gap={bumperGap(LEFT)} />);
  const kept = new Set([...document.querySelectorAll("[data-testid=selfie-design-ring] circle")].map(dot => dot.getAttribute("cx") + "," + dot.getAttribute("cy")));
  const left = all.filter(dot => !kept.has(dot)).map(dot => dot.split(",").map(Number));
  // 54° of 360° on a 64-dot ring is about nine dots, all on the left side.
  expect(left.length).toBeGreaterThanOrEqual(8);
  expect(left.length).toBeLessThanOrEqual(11);
  const [leftX] = ringPoint(270);
  for (const [x] of left) expect(x).toBeLessThan(leftX + 40);
});
