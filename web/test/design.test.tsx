import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { Button } from "../design/Button";
import { buttonStyle, disabledStyle } from "../design/buttons";
import { Icon } from "../design/Icon";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
afterEach(() => cleanup());
afterAll(() => GlobalRegistrator.unregister());

test("button styles follow the Nucleus variant and size", () => {
  expect(buttonStyle("primary48")).toContain("bg-background-inverse text-foreground-inverse");
  expect(buttonStyle("primary48")).toContain("min-h-12 px-6 py-3.5 text-l1");
  expect(buttonStyle("tertiary32")).toContain("border border-stroke-secondary");
  expect(buttonStyle("tertiary32")).toContain("text-l3");
  expect(disabledStyle("secondary40")).toBe("disabled40");
});

test("disabled buttons switch to the disabled style; loading keeps the style and blocks taps", () => {
  const view = render(<>
    <Button buttonStyle="primary48" disabled>Continue</Button>
    <Button buttonStyle="primary48" loading>Verify</Button>
  </>);
  const disabled = view.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  expect(disabled.disabled).toBe(true);
  expect(disabled.className).toContain("bg-background-disabled");
  const loading = view.getByRole("button", { name: "Verify" }) as HTMLButtonElement;
  expect(loading.disabled).toBe(true);
  expect(loading.getAttribute("aria-busy")).toBe("true");
  expect(loading.className).toContain("bg-background-inverse");
  expect(loading.querySelector("svg")).not.toBeNull();
});

test("icons are decorative unless labelled and fall back to the variant Nucleus has", () => {
  const view = render(<>
    <Icon icon="check" label="Shared" />
    <Icon icon="check" variant="solid" />
  </>);
  expect(view.getByRole("img", { name: "Shared" }).dataset.icon).toBe("check");
  const fallback = view.container.querySelector('[data-icon="check"][aria-hidden="true"]') as HTMLElement;
  expect(fallback.getAttribute("aria-hidden")).toBe("true");
  // Inline SVG, not a data: URL: the CSP allows only same-origin images.
  expect(fallback.querySelector("svg")?.innerHTML).toContain("currentColor");
  expect(fallback.innerHTML).toBe(view.getByRole("img", { name: "Shared" }).innerHTML);
});
