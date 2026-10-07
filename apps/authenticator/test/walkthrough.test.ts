import { describe, expect, test } from "bun:test";
import {
  SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
  SIMULATOR_UI_QUALITY_POLICY_V0,
  validateFrameBundleV0,
  type FrameBundleV0,
} from "@clean-start/contracts";
import type {
  BrowserCaptureAdapterV1,
  BrowserCaptureCallbacksV1,
  BrowserCaptureStartV1,
} from "../src/adapters/browser-capture";
import { createLocalDemoPasskeyV1 } from "../src/walkthrough/live-passkey";
import { LIVE_GUIDANCE_MODEL_V1 } from "../src/walkthrough/model-provenance";
import {
  LocalWalkthroughCaptureAdapterV1,
  makeLocalWalkthroughAdmissionV1,
} from "../src/walkthrough/walkthrough-adapters";

const expiresAt = "2030-01-01T00:00:00.000Z";

function randomBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_value, index) => index + 1);
}

describe("local walkthrough live boundaries", () => {
  test("pins the self-hosted face guidance model to its official checksum", async () => {
    const model = await Bun.file(new URL(
      `../public${LIVE_GUIDANCE_MODEL_V1.modelPath}`,
      import.meta.url,
    )).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", model);
    const actual = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(actual).toBe(LIVE_GUIDANCE_MODEL_V1.modelSha256);
    expect(LIVE_GUIDANCE_MODEL_V1.securityDecision).toBe(false);
    expect(LIVE_GUIDANCE_MODEL_V1.sendsMeasurementsToServer).toBe(false);
  });

  test("creates a real browser credential request but retains only status and PRF capability", async () => {
    let observed: CredentialCreationOptions | undefined;
    const result = await createLocalDemoPasskeyV1({
      secureContext: true,
      hostname: "localhost",
      publicKeyCredentialAvailable: true,
      randomBytes,
      nowEpochMs: () => 1_234,
      createCredential: async (options) => {
        observed = options;
        return {
          type: "public-key",
          getClientExtensionResults: () => ({ prf: { enabled: true } }),
        } as unknown as Credential;
      },
    });

    expect(result).toEqual({ status: "created", prfCapability: "available" });
    expect(Object.keys(result).sort()).toEqual(["prfCapability", "status"]);
    expect(observed?.publicKey?.rp).toEqual({
      id: "localhost",
      name: "World ID",
    });
    expect(observed?.publicKey?.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    expect(observed?.publicKey?.extensions).toEqual({ prf: {} });
    expect(JSON.stringify(result)).not.toMatch(/credential|private|secret|provider/i);
  });

  test("classifies unavailable and cancelled passkey prompts without leaking errors", async () => {
    const unavailable = await createLocalDemoPasskeyV1({
      secureContext: false,
      hostname: "localhost",
      publicKeyCredentialAvailable: false,
      randomBytes,
      nowEpochMs: () => 1,
    });
    expect(unavailable).toEqual({ status: "unsupported", prfCapability: "unknown" });

    const cancelled = await createLocalDemoPasskeyV1({
      secureContext: true,
      hostname: "localhost",
      publicKeyCredentialAvailable: true,
      randomBytes,
      nowEpochMs: () => 2,
      createCredential: () => Promise.reject({
        name: "NotAllowedError",
        message: "must-not-be-retained",
      }),
    });
    expect(cancelled).toEqual({ status: "cancelled", prfCapability: "unknown" });
    expect(JSON.stringify(cancelled)).not.toContain("must-not-be-retained");
  });

  test("marks localhost admission as an explicit walkthrough bypass", () => {
    const decision = makeLocalWalkthroughAdmissionV1("chrome");
    expect(decision.outcome).toBe("eligible_candidate");
    expect(decision.browser).toBe("chrome");
    expect(decision.iosVersionBand).toBe("ios_18_plus");
    expect(decision.engine).toBe("unknown");
    expect(decision.provider).toBe("unknown");
  });

  test("falls back to a valid constant metadata descriptor after camera denial", async () => {
    const statuses: string[] = [];
    const states: string[] = [];
    let artifact: FrameBundleV0 | undefined;
    let completed = 0;
    const deniedLiveAdapter: BrowserCaptureAdapterV1 = {
      start(_input: BrowserCaptureStartV1, callbacks: BrowserCaptureCallbacksV1) {
        void callbacks.onFailure("permission_denied");
      },
      requestMetadataCollection() {},
      stop() {},
      clearTransientMedia() {},
      unmount() {},
    };
    const adapter = new LocalWalkthroughCaptureAdapterV1({
      getVideo: () => null,
      getCanvas: () => null,
      onStatus: (status) => statuses.push(status),
      liveAdapter: deniedLiveAdapter,
    });
    const input: BrowserCaptureStartV1 = {
      entry: {
        userActivated: true,
        secureTopLevelContextApproved: true,
        prfReady: true,
        iosMajor: 18,
        browser: "chrome",
      },
      policy: { ...SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0, expiresAt },
      qualityPolicy: SIMULATOR_UI_QUALITY_POLICY_V0,
      sessionId: "walkthrough-session",
      accountPublicMaterialDigestSha256: "a".repeat(64),
      nonceDigestSha256: "b".repeat(64),
      retakesUsed: 0,
    };
    adapter.start(input, {
      onCaptureState: (state) => { states.push(state); },
      onQuality: (quality) => { expect(quality.action).toBe("ready"); },
      onArtifactReady: (value) => { artifact = value; },
      onFailure: (code) => { throw new Error(`unexpected_${code}`); },
      onComplete: () => { completed += 1; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(statuses).toEqual(["requesting", "synthetic_fallback"]);
    expect(states).toEqual(["acquiring", "awaiting_first_frame", "preview"]);

    adapter.requestMetadataCollection();
    for (let attempt = 0; artifact === undefined && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(artifact?.dataMode).toBe("metadata_only");
    expect(artifact?.frames).toHaveLength(1);
    expect(Object.keys(artifact?.frames[0] ?? {})).not.toContain("pixels");
    expect(await validateFrameBundleV0(artifact, input.policy)).toEqual([]);
    expect(states.slice(-2)).toEqual(["artifact_ready", "cleaning_up"]);
    expect(statuses.at(-1)).toBe("synthetic_complete");
    expect(completed).toBe(1);
    expect(JSON.stringify(artifact)).not.toMatch(/pixels|data:image|blob:/i);
  });

  test("starts live guidance at preview and stops it with capture cleanup", async () => {
    let starts = 0;
    let stops = 0;
    const liveAdapter: BrowserCaptureAdapterV1 = {
      start(_input, callbacks) {
        void (async () => {
          await callbacks.onCaptureState("preview");
          await callbacks.onComplete();
        })();
      },
      requestMetadataCollection() {},
      stop() {},
      clearTransientMedia() {},
      unmount() {},
    };
    const adapter = new LocalWalkthroughCaptureAdapterV1({
      getVideo: () => null,
      getCanvas: () => null,
      onStatus: () => undefined,
      onGuidance: () => undefined,
      liveAdapter,
      guidanceController: {
        start: () => { starts += 1; },
        stop: () => { stops += 1; },
      },
    });
    adapter.start({
      entry: {
        userActivated: true,
        secureTopLevelContextApproved: true,
        prfReady: true,
        iosMajor: 18,
        browser: "chrome",
      },
      policy: { ...SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0, expiresAt },
      qualityPolicy: SIMULATOR_UI_QUALITY_POLICY_V0,
      sessionId: "guidance-session",
      accountPublicMaterialDigestSha256: "a".repeat(64),
      nonceDigestSha256: "b".repeat(64),
      retakesUsed: 0,
    }, {
      onCaptureState: () => undefined,
      onQuality: () => undefined,
      onArtifactReady: () => undefined,
      onFailure: () => undefined,
      onComplete: () => undefined,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toBe(1);
    expect(stops).toBeGreaterThanOrEqual(1);
  });
});
