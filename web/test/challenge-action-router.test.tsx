import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { activeChallengeAction, ChallengeActionRouter, type ChallengeActionTranscript } from "../components/ChallengeActionRouter";

beforeAll(() => GlobalRegistrator.register());
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const transcript: ChallengeActionTranscript = {
  actions: [
    { id: "center", type: "center_face" },
    { id: "right", type: "turn_head", direction: "right" },
    { id: "hold", type: "hold_still" },
    { id: "left", type: "turn_head", direction: "left" },
    { id: "evaluate", type: "evaluate" },
  ],
  activeActionId: "center",
};

test("routes the server's active action, including right before left and revisiting a step", () => {
  const view = render(<ChallengeActionRouter transcript={transcript} />);
  for (const [activeActionId, title] of [
    ["center", "Look straight ahead"], ["right", "Turn your head right"],
    ["hold", "Hold it there"], ["left", "Turn your head left"],
    ["right", "Turn your head right"], ["evaluate", "Checking your capture"],
  ]) {
    view.rerender(<ChallengeActionRouter transcript={{ ...transcript, activeActionId }} />);
    expect(view.getByRole("heading", { name: title })).toBeTruthy();
    expect(view.getAllByRole("heading")).toHaveLength(1);
  }
  expect(view.queryByText(/complete|verified/i)).toBeNull();
});

test("a repeated server transcript keeps the same active step", () => {
  const input = { ...transcript, activeActionId: "left" };
  const view = render(<ChallengeActionRouter transcript={input} />);
  view.rerender(<ChallengeActionRouter transcript={structuredClone(input)} />);
  expect(view.getByRole("heading", { name: "Turn your head left" })).toBeTruthy();
  expect(view.container.querySelector(".selfie-turn-indicator")?.getAttribute("data-direction")).toBe("left");
});

for (const input of [
  null, {}, { ...transcript, activeActionId: "missing" },
  { ...transcript, actions: [null] },
  { ...transcript, actions: [] }, { ...transcript, actions: Array(65).fill(transcript.actions[0]) },
  { ...transcript, actions: [...transcript.actions, transcript.actions[0]] },
  { activeActionId: "bad", actions: [{ id: "bad", type: "turn_head", direction: "diagonal" }] },
  { activeActionId: "bad", actions: [{ id: "bad", type: "unknown" }] },
  { activeActionId: "bad", actions: [{ id: "bad", type: "turn_head" }] },
  { ...transcript, actions: [{ id: "x".repeat(129), type: "center_face" }] },
]) {
  test(`missing or unsupported transcript fails visibly: ${JSON.stringify(input).slice(0, 90)}`, () => {
    expect(activeChallengeAction(input)).toBeUndefined();
    const view = render(<ChallengeActionRouter transcript={input} />);
    expect(view.getByRole("alert").textContent).toContain("This check can’t continue");
    expect(view.queryByRole("status")).toBeNull();
  });
}
