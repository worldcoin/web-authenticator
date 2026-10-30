import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { AuthenticatorAppV1 } from "../App";
import type { ConsentClient } from "../lib/consent";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

const consent: ConsentClient = { read: async () => "denied", save: async choice => choice };
const open = async () => { throw new Error("not used"); };

test("the root path renders the landing page", async () => {
  const view = render(<AuthenticatorAppV1 services={{ open, load: async () => null }} consent={consent} />);
  expect(await view.findByRole("button", { name: /Go to authenticator/ })).toBeTruthy();
});

// A numeric-looking key is valid base64; the router's default JSON codec would rewrite it.
test("the app receives the request URL exactly as opened, then the key leaves the address bar", async () => {
  const href = "http://localhost:4173/verify?t=wld&i=550e8400-e29b-41d4-a716-446655440000&k=MTIz&b=https%3A%2F%2Fstaging-bridge.worldcoin.org";
  window.history.replaceState(null, "", href);
  const loaded: string[] = [];
  const view = render(<AuthenticatorAppV1 services={{ open, load: async source => { loaded.push(source); return null; } }} consent={consent} />);
  await view.findByRole("heading", { name: "This request can’t be verified" });
  expect(loaded).toEqual([href]);
  expect(window.location.pathname).toBe("/verify");
  expect(window.location.search).toBe("");
});
