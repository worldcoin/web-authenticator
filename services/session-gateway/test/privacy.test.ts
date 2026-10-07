import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GatewayErrorV0 } from "../src";
import { CONTEXT, makeHarness, reachCaptureReady } from "./helpers";

describe("privacy and redaction sentinels", () => {
  test("source has no network, persistent-storage, private-key literal, or raw logging path", async () => {
    const sourceDirectory = join(import.meta.dir, "../src");
    const source = (await Promise.all((await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts")).map((name) => readFile(join(sourceDirectory, name), "utf8")))).join("\n");
    for (const token of ["console.", "fetch(", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage", "indexedDB", ["BEGIN", "PRIVATE", "KEY"].join(" "), ["PRIVATE", "KEY-----"].join(" "), "data:image", "createObjectURL"]) {
      expect(source).not.toContain(token);
    }
  });

  test("upstream errors collapse to stable codes without copied text", async () => {
    const harness = await makeHarness();
    harness.biometricMode = "throw";
    const { ready } = await reachCaptureReady(harness);
    const bundle = await (await import("./helpers")).makeBundle(ready.session.sessionId, ready.session.nonceBase64Url);
    const result = await harness.gateway.submitCapture({ sessionId: ready.session.sessionId, browserHandle: ready.browserHandle, idempotencyKey: "capture", nonceBase64Url: ready.session.nonceBase64Url, frameBundle: bundle }, CONTEXT);
    expect(result.code).toBe("simulation_unavailable");
    expect(JSON.stringify(result)).not.toContain("untrusted upstream details");
  });

  test("public errors expose only stable codes", () => {
    const error = new GatewayErrorV0("artifact_invalid", 400);
    expect(error.toResponse()).toEqual({ code: "artifact_invalid" });
    expect(Object.keys(error.toResponse())).toEqual(["code"]);
  });
});
