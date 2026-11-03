import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AuthenticatorAppV1 } from "../App";
import type { ConsentClient } from "../lib/consent";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

const consent: ConsentClient = { read: async () => "denied", save: async choice => choice };
const open = async () => { throw new Error("not used"); };
const requestId = "550e8400-e29b-41d4-a716-446655440000";

function app(load: (source: string) => Promise<null> = async () => null) {
  return render(<AuthenticatorAppV1 services={{ open, load }} consent={consent} />);
}

test("the root path is the landing page and does not read request links", async () => {
  window.history.replaceState(null, "", `/?t=wld&i=${requestId}&k=a2V5`);
  const loaded: string[] = [];
  const view = app(async source => { loaded.push(source); return null; });
  expect(await view.findByRole("heading", { name: "Download World ID" })).toBeTruthy();
  expect(loaded).toEqual([]);
});

test("Go to authenticator and Back to home move between / and /authenticator", async () => {
  const view = app();
  fireEvent.click(await view.findByRole("button", { name: "Go to authenticator" }));
  expect(await view.findByRole("heading", { name: "Your authenticator" })).toBeTruthy();
  expect(window.location.pathname).toBe("/authenticator");
  fireEvent.click(view.getByRole("button", { name: "Back to home" }));
  expect(await view.findByRole("heading", { name: "Download World ID" })).toBeTruthy();
  expect(window.location.pathname).toBe("/");
});

test("/authenticator opens directly", async () => {
  window.history.replaceState(null, "", "/authenticator");
  const view = app();
  expect(await view.findByRole("heading", { name: "Your authenticator" })).toBeTruthy();
});

test("/verify without a request is invalid rather than the landing page", async () => {
  window.history.replaceState(null, "", "/verify");
  const view = app();
  expect(await view.findByRole("heading", { name: "This request can’t be verified" })).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Download World ID" })).toBeNull();
});

// A numeric-looking key is valid base64; the router's default JSON codec would rewrite it.
test("/verify receives the request URL exactly as opened, then the key leaves the address bar", async () => {
  const href = `http://localhost:4173/verify?t=wld&i=${requestId}&k=MTIz&b=https%3A%2F%2Fstaging-bridge.worldcoin.org`;
  window.history.replaceState(null, "", href);
  const loaded: string[] = [];
  const view = app(async source => { loaded.push(source); return null; });
  await view.findByRole("heading", { name: "This request can’t be verified" });
  expect(loaded).toEqual([href]);
  expect(window.location.pathname).toBe("/verify");
  expect(window.location.search).toBe("");
});
