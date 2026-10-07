import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  makeAuthenticatorUiSnapshotV1,
} from "@clean-start/contracts";
import { createAuthenticatorServerRuntimeV0 } from "../src/server/runtime.server";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe("static demo entry", () => {
  test("drives the in-page simulator through the passkey step with no HTTP at all", async () => {
    const { makeAuthenticatorControllerFactoryV1 } = await import("../src/App");
    const runtime = await createAuthenticatorServerRuntimeV0();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new TypeError("static demo must not use HTTP");
    }) as unknown as typeof fetch;
    try {
      const controller = makeAuthenticatorControllerFactoryV1(runtime.browserPort)(
        { getVideo: () => null, getCanvas: () => null },
        makeAuthenticatorUiSnapshotV1({
          state: "request_checking",
          visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1.request_checking,
        }),
      );
      controller.start();
      await controller.waitForIdle();
      expect(controller.snapshot.state).toBe("request_review");
      controller.act("continue");
      await controller.waitForIdle();
      expect(["admission_safari_candidate", "admission_chrome_candidate"])
        .toContain(controller.snapshot.state);
      controller.act("continue");
      expect(controller.snapshot.state).toBe("demo_authenticator_intro");
      controller.act("start_demo_authenticator");
      await controller.waitForIdle();
      expect(controller.snapshot.state).toBe("demo_authenticator_ready");
      expect(controller.snapshot.authoritativeSessionState).toBe("passkey_complete");
      controller.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalls).toBe(0);
  });

  test("keeps the in-page simulator out of the served app entry", async () => {
    const served = await Bun.file(new URL("../src/main.tsx", import.meta.url)).text();
    expect(served).not.toContain("runtime.server");
    expect(served).not.toContain("static-demo");
    const staticEntry = await Bun.file(new URL("../static-demo/main.tsx", import.meta.url)).text();
    expect(staticEntry).toContain("createAuthenticatorServerRuntimeV0");
    expect(staticEntry).toContain("makeAuthenticatorControllerFactoryV1");
  });
});
