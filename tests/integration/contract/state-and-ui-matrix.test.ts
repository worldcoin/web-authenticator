import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { createElement } from "react";
import {
  AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1,
  AUTHENTICATOR_UI_ACTIONS_V1,
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  AUTHENTICATOR_UI_STATE_PROGRESS_V1,
  AUTHENTICATOR_UI_STATES_V1,
  dispatchAuthenticatorUiActionV1,
  type AuthenticatorUiActionV1,
} from "@clean-start/contracts";
import { FlowScreenV1 } from "../../../apps/authenticator/src/components/FlowScreen";
import {
  FIGMA_SCREEN_MATRIX_V1,
  SCREEN_RENDER_REGISTRY_V1,
} from "../../../apps/authenticator/src/flow/render-registry";
import { snapshotFor } from "../testkit/ui";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => {
  cleanup();
  GlobalRegistrator.unregister();
});

describe("frozen state, action, and visual evidence matrix", () => {
  test("covers every one of the 62 frozen states in every registry", () => {
    expect(AUTHENTICATOR_UI_STATES_V1).toHaveLength(62);
    for (const registry of [
      AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1,
      AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
      AUTHENTICATOR_UI_STATE_PROGRESS_V1,
      SCREEN_RENDER_REGISTRY_V1,
    ]) {
      expect(Object.keys(registry).sort()).toEqual([...AUTHENTICATOR_UI_STATES_V1].sort());
      expect(Object.isFrozen(registry)).toBe(true);
    }
    expect(FIGMA_SCREEN_MATRIX_V1.verified).toHaveLength(15);
    expect(FIGMA_SCREEN_MATRIX_V1.notFigmaVerified).toEqual([]);
  });

  test("renders every frozen state with its exact legal actions and safe semantics", () => {
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      const observed: AuthenticatorUiActionV1[] = [];
      const view = render(createElement(FlowScreenV1, {
        snapshot: snapshotFor(state),
        onAction: (action) => observed.push(action),
      }));
      expect(view.container.querySelectorAll("main")).toHaveLength(1);
      expect(view.container.querySelectorAll("h1")).toHaveLength(1);
      expect(view.getByRole("main").dataset.state).toBe(state);
      expect(view.container.textContent).toContain("Staging demo");
      const buttons = [...view.container.querySelectorAll<HTMLButtonElement>("button[data-action]")];
      expect(buttons.map((button) => button.dataset.action).sort()).toEqual(
        [...AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state]].sort(),
      );
      for (const button of buttons) fireEvent.click(button);
      expect(observed.sort()).toEqual([...AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state]].sort());
      expect(view.container.querySelectorAll('[data-action="cancel"]')).toHaveLength(
        AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state].includes("cancel") ? 1 : 0,
      );
      expect(view.container.textContent).not.toMatch(/\b\d{1,3}%\b|\bETA\b|countdown/i);
      view.unmount();
    }
  });

  test("keeps every illegal action inert for every state", () => {
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      const snapshot = snapshotFor(state);
      for (const action of AUTHENTICATOR_UI_ACTIONS_V1) {
        if (AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state].includes(action)) continue;
        expect(dispatchAuthenticatorUiActionV1(snapshot, action)).toBeNull();
      }
    }
  });

  test("has no automated axe violations in any frozen state", async () => {
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      const view = render(createElement(FlowScreenV1, {
        snapshot: snapshotFor(state),
        onAction: () => undefined,
      }));
      const result = await axe.run(view.container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations, state).toEqual([]);
      view.unmount();
    }
  });

  test("moves focus to the state heading and preserves non-color text meaning", () => {
    const view = render(createElement(FlowScreenV1, {
      snapshot: snapshotFor("request_review"),
      onAction: () => undefined,
    }));
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      view.rerender(createElement(FlowScreenV1, {
        snapshot: snapshotFor(state),
        onAction: () => undefined,
      }));
      expect(document.activeElement).toBe(view.container.querySelector("h1"));
      expect(view.container.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});
