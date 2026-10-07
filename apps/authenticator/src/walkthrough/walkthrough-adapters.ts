import {
  BROWSER_ADMISSION_V1,
  type BrowserAdmissionDecisionV1,
} from "@clean-start/browser-admission";
import { buildFrameBundle } from "@clean-start/frame-capture";
import type {
  BrowserAdmissionAdapterV1,
} from "../adapters/browser-admission";
import {
  BrowserMetadataCaptureAdapterV1,
  type BrowserCaptureAdapterV1,
  type BrowserCaptureCallbacksV1,
  type BrowserCaptureStartV1,
} from "../adapters/browser-capture";
import {
  LiveFaceGuidanceControllerV1,
  type LiveFaceGuidanceV1,
} from "./live-face-guidance";

export type WalkthroughCameraStatusV1 =
  | "idle"
  | "requesting"
  | "live"
  | "synthetic_fallback"
  | "live_complete"
  | "synthetic_complete"
  | "failed";

function browserFamily(): "safari" | "chrome" {
  return /(?:Chrome|CriOS|Chromium)\//i.test(navigator.userAgent) ? "chrome" : "safari";
}

export function makeLocalWalkthroughAdmissionV1(
  browser: "safari" | "chrome" = browserFamily(),
): BrowserAdmissionDecisionV1 {
  return Object.freeze({
    version: BROWSER_ADMISSION_V1,
    outcome: "eligible_candidate",
    reason: "candidate_only_ceremony_required",
    mayStartSensitiveFlow: true,
    browser,
    iosVersionBand: "ios_18_plus",
    context: "normal_tab",
    engine: "unknown",
    region: "unknown",
    provider: "unknown",
    capabilities: Object.freeze({
      webAuthnApi: typeof PublicKeyCredential === "undefined" ? "unavailable" : "available",
      platformUv: "unknown",
      clientCapabilitiesApi: "unknown",
      conditionalMediation: "unknown",
      mediaApi: typeof navigator.mediaDevices?.getUserMedia === "function"
        ? "available"
        : "unavailable",
      visibility: "visible",
    }),
  });
}

export function createLocalWalkthroughAdmissionAdapterV1(): BrowserAdmissionAdapterV1 {
  return Object.freeze({
    async evaluate() {
      return makeLocalWalkthroughAdmissionV1();
    },
    async openExternalBrowser() {
      throw new TypeError("walkthrough_handoff_not_available");
    },
  });
}

interface FallbackAttemptV1 {
  readonly generation: number;
  readonly input: BrowserCaptureStartV1;
  readonly callbacks: BrowserCaptureCallbacksV1;
  ready: boolean;
  finalizing: boolean;
  livePreview: boolean;
}

async function constantFallbackFrameDigestV1(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(4));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class LocalWalkthroughCaptureAdapterV1 implements BrowserCaptureAdapterV1 {
  private readonly live: BrowserCaptureAdapterV1;
  private readonly guidance?: Pick<LiveFaceGuidanceControllerV1, "start" | "stop">;
  private readonly onGuidance?: (guidance: LiveFaceGuidanceV1) => void;
  private generation = 0;
  private attempt?: FallbackAttemptV1;

  constructor(options: {
    readonly getVideo: () => HTMLVideoElement | null;
    readonly getCanvas: () => HTMLCanvasElement | null;
    readonly onStatus: (status: WalkthroughCameraStatusV1) => void;
    readonly onGuidance?: (guidance: LiveFaceGuidanceV1) => void;
    readonly liveAdapter?: BrowserCaptureAdapterV1;
    readonly guidanceController?: Pick<LiveFaceGuidanceControllerV1, "start" | "stop">;
  }) {
    this.onStatus = options.onStatus;
    this.onGuidance = options.onGuidance;
    this.live = options.liveAdapter ?? new BrowserMetadataCaptureAdapterV1({
      getVideo: options.getVideo,
      getCanvas: options.getCanvas,
    });
    this.guidance = options.guidanceController ?? (options.onGuidance === undefined
      ? undefined
      : new LiveFaceGuidanceControllerV1(options.getVideo, options.onGuidance));
  }

  private readonly onStatus: (status: WalkthroughCameraStatusV1) => void;

  start(input: BrowserCaptureStartV1, callbacks: BrowserCaptureCallbacksV1): void {
    const attempt: FallbackAttemptV1 = {
      generation: ++this.generation,
      input,
      callbacks,
      ready: false,
      finalizing: false,
      livePreview: false,
    };
    this.attempt = attempt;
    this.onStatus("requesting");
    try {
      this.live.start(input, {
        onCaptureState: async (state) => {
          if (this.attempt !== attempt) return;
          if (state === "preview") {
            attempt.livePreview = true;
            this.onStatus("live");
          }
          await callbacks.onCaptureState(state);
          if (state === "preview") this.guidance?.start();
        },
        onQuality: callbacks.onQuality,
        onArtifactReady: callbacks.onArtifactReady,
        onFailure: async (code) => {
          if (this.attempt !== attempt) return;
          if (attempt.livePreview) {
            this.guidance?.stop();
            this.onStatus("failed");
            await callbacks.onFailure(code);
            return;
          }
          await this.activateFallback(attempt);
        },
        onComplete: async () => {
          this.guidance?.stop();
          if (this.attempt === attempt) this.attempt = undefined;
          this.onStatus(attempt.livePreview ? "live_complete" : "synthetic_complete");
          await callbacks.onComplete();
        },
      });
    } catch {
      void this.activateFallback(attempt);
    }
  }

  requestMetadataCollection(): void {
    const attempt = this.attempt;
    if (attempt?.ready === true) {
      void this.finalizeFallback(attempt);
      return;
    }
    this.live.requestMetadataCollection();
  }

  stop(): void {
    this.generation += 1;
    this.attempt = undefined;
    this.guidance?.stop();
    this.live.stop();
  }

  clearTransientMedia(): void {
    this.guidance?.stop();
    this.live.clearTransientMedia();
  }

  unmount(): void {
    this.generation += 1;
    this.attempt = undefined;
    this.guidance?.stop();
    this.live.unmount();
  }

  private async activateFallback(attempt: FallbackAttemptV1): Promise<void> {
    if (this.attempt !== attempt || attempt.generation !== this.generation) return;
    attempt.ready = true;
    this.guidance?.stop();
    this.onGuidance?.(Object.freeze({
      code: "unavailable",
      text: "Camera unavailable",
    }));
    this.onStatus("synthetic_fallback");
    await attempt.callbacks.onCaptureState("acquiring");
    await attempt.callbacks.onCaptureState("awaiting_first_frame");
    await attempt.callbacks.onCaptureState("preview");
  }

  private async finalizeFallback(attempt: FallbackAttemptV1): Promise<void> {
    if (
      this.attempt !== attempt ||
      attempt.generation !== this.generation ||
      attempt.finalizing
    ) return;
    attempt.finalizing = true;
    try {
      await attempt.callbacks.onQuality({
        version: "client_quality_policy_v0",
        policyId: attempt.input.qualityPolicy.policyId,
        action: "ready",
        reasonCodes: [],
      });
      const artifact = await buildFrameBundle({
        sessionId: attempt.input.sessionId,
        policy: attempt.input.policy,
        accountPublicMaterialDigestSha256:
          attempt.input.accountPublicMaterialDigestSha256,
        nonceDigestSha256: attempt.input.nonceDigestSha256,
        frames: [{
          transportIndex: 0,
          width: 1,
          height: 1,
          encoding: "rgba8",
          byteLength: 4,
          frameDigestSha256: await constantFallbackFrameDigestV1(),
        }],
      });
      await attempt.callbacks.onArtifactReady(artifact);
      await attempt.callbacks.onCaptureState("artifact_ready");
      await attempt.callbacks.onCaptureState("cleaning_up");
      this.onStatus("synthetic_complete");
      await attempt.callbacks.onComplete();
    } catch {
      this.onStatus("failed");
      await attempt.callbacks.onFailure("unknown");
    } finally {
      if (this.attempt === attempt) this.attempt = undefined;
    }
  }
}
