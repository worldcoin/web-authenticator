import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DemoRequestSchema } from "../../config/demo";
import { isDemoHandoff } from "../lib/demo";
import { isDemoPreview, loadDemoPreview, startDemoPreview } from "../lib/demo-preview";
import { checkExpiry } from "../lib/proof-request";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/demo" }));
afterAll(() => GlobalRegistrator.unregister());

test("runs only on http://localhost", () => {
  expect(isDemoPreview({ protocol: "http:", hostname: "localhost" })).toBe(true);
  for (const location of [
    { protocol: "https:", hostname: "authenticator.toolsforhumanity.dev" },
    { protocol: "http:", hostname: "127.0.0.1" },
    { protocol: "https:", hostname: "localhost" },
  ]) expect(isDemoPreview(location)).toBe(false);
});

test("hands /verify a Selfie Check request that matches the demo attempt", () => {
  const attempt = startDemoPreview();
  expect(DemoRequestSchema.safeParse(attempt.config).success).toBe(true);
  const incoming = loadDemoPreview(attempt.request.connectorURI);
  if (!incoming) throw new Error("Expected the preview request.");
  expect(isDemoHandoff(attempt, incoming)).toBe(true);
  expect(() => checkExpiry(incoming.proof)).not.toThrow();
  expect(attempt.request.connectorURI).toBe(`http://localhost:4173/verify?${attempt.query}`);
  expect(startDemoPreview().bridgeId).not.toBe(attempt.bridgeId);
});

test("leaves real requests and unknown preview IDs to the normal loader", async () => {
  expect(loadDemoPreview("http://localhost:4173/verify?t=wld&i=550e8400-e29b-41d4-a716-446655440000&k=a2V5")).toBeUndefined();
  expect(loadDemoPreview("http://localhost:4173/verify")).toBeUndefined();
  const incoming = loadDemoPreview(startDemoPreview().request.connectorURI);
  if (!incoming) throw new Error("Expected the preview request.");
  await expect(incoming.deliver("{}", AbortSignal.timeout(1000))).rejects.toThrow("cannot send proofs");
});
