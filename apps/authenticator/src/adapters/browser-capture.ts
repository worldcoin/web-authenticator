import {
  evaluateClientQualityV0,
  type EvaluatedClientQualityResultV0,
} from "@clean-start/client-quality";
import {
  MetadataOnlyCaptureRuntime,
  createBrowserCapturePlatform,
  type ApprovedCaptureEntry,
  type CaptureFailureCode,
  type CaptureRequest,
  type CaptureRuntimeOptions,
  type CaptureState,
} from "@clean-start/frame-capture";
import type {
  ClientQualityPolicyV0,
  FrameBundleV0,
  HexSha256,
  SimulationCapturePolicyV0,
} from "@clean-start/contracts";

interface CaptureRuntimeV1 {
  capture(request: CaptureRequest): Promise<FrameBundleV0>;
  cancel(): void;
  unmount(): void;
}

export interface BrowserCaptureStartV1 {
  readonly entry: ApprovedCaptureEntry;
  readonly policy: SimulationCapturePolicyV0;
  readonly qualityPolicy: ClientQualityPolicyV0;
  readonly sessionId: string;
  readonly accountPublicMaterialDigestSha256: HexSha256;
  readonly nonceDigestSha256: HexSha256;
  readonly retakesUsed: number;
}

export interface BrowserCaptureCallbacksV1 {
  readonly onCaptureState: (state: CaptureState) => void | Promise<void>;
  readonly onQuality: (result: EvaluatedClientQualityResultV0) => void | Promise<void>;
  readonly onArtifactReady: (artifact: FrameBundleV0) => void | Promise<void>;
  readonly onFailure: (code: CaptureFailureCode) => void | Promise<void>;
  readonly onComplete: () => void | Promise<void>;
}

export interface BrowserCaptureAdapterV1 {
  start(input: BrowserCaptureStartV1, callbacks: BrowserCaptureCallbacksV1): void;
  requestMetadataCollection(): void;
  stop(): void;
  clearTransientMedia(): void;
  unmount(): void;
}

class QualityOutcomeStopV1 extends Error {}

export class BrowserMetadataCaptureAdapterV1 implements BrowserCaptureAdapterV1 {
  private runtime?: CaptureRuntimeV1;
  private qualityRequested = false;
  private releaseQuality?: () => void;
  private nonReadyQuality = false;

  constructor(private readonly options: {
    readonly video?: HTMLVideoElement;
    readonly canvas?: HTMLCanvasElement;
    readonly getVideo?: () => HTMLVideoElement | null;
    readonly getCanvas?: () => HTMLCanvasElement | null;
    readonly runtimeFactory?: (options: CaptureRuntimeOptions) => CaptureRuntimeV1;
  }) {}

  start(input: BrowserCaptureStartV1, callbacks: BrowserCaptureCallbacksV1): void {
    if (this.runtime !== undefined) {
      void callbacks.onFailure("capture_in_progress");
      return;
    }
    this.qualityRequested = false;
    this.nonReadyQuality = false;
    const runtimeOptions: CaptureRuntimeOptions = {
      onStateChange: (state) => {
        if (
          state === "acquiring" ||
          state === "awaiting_first_frame" ||
          state === "preview"
        ) void callbacks.onCaptureState(state);
      },
    };
    const runtime = this.options.runtimeFactory?.(runtimeOptions) ??
      this.createBrowserRuntime(runtimeOptions);
    this.runtime = runtime;

    const capturePromise = runtime.capture({
      entry: input.entry,
      policy: input.policy,
      sessionId: input.sessionId,
      accountPublicMaterialDigestSha256: input.accountPublicMaterialDigestSha256,
      nonceDigestSha256: input.nonceDigestSha256,
      inspectTransientFrame: async () => {
        await new Promise<void>((resolve) => {
          this.releaseQuality = resolve;
          if (this.qualityRequested) resolve();
        });
        this.releaseQuality = undefined;
        const result = evaluateClientQualityV0(
          input.qualityPolicy,
          { readCameraActive: () => true },
          { retakesUsed: input.retakesUsed },
        );
        await callbacks.onQuality(result);
        if (result.action !== "ready") {
          this.nonReadyQuality = true;
          throw new QualityOutcomeStopV1();
        }
      },
    });

    void capturePromise.then(async (artifact) => {
      this.runtime = undefined;
      await callbacks.onArtifactReady(artifact);
      await callbacks.onCaptureState("artifact_ready");
      await callbacks.onCaptureState("cleaning_up");
      await callbacks.onComplete();
    }).catch(async (cause: unknown) => {
      this.runtime = undefined;
      if (this.nonReadyQuality || cause instanceof QualityOutcomeStopV1) return;
      const code = typeof cause === "object" && cause !== null &&
        "code" in cause && typeof (cause as { readonly code?: unknown }).code === "string"
        ? (cause as { readonly code: CaptureFailureCode }).code
        : "unknown";
      await callbacks.onFailure(code);
    });
  }

  requestMetadataCollection(): void {
    this.qualityRequested = true;
    this.releaseQuality?.();
  }

  stop(): void {
    this.runtime?.cancel();
  }

  clearTransientMedia(): void {
    this.releaseQuality?.();
    this.releaseQuality = undefined;
    const video = this.options.video ?? this.options.getVideo?.() ?? undefined;
    if (video !== undefined) video.srcObject = null;
    const canvas = this.options.canvas ?? this.options.getCanvas?.() ?? undefined;
    if (canvas !== undefined) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  unmount(): void {
    this.runtime?.unmount();
    this.clearTransientMedia();
  }

  private createBrowserRuntime(options: CaptureRuntimeOptions): CaptureRuntimeV1 {
    const video = this.options.video ?? this.options.getVideo?.() ?? undefined;
    const canvas = this.options.canvas ?? this.options.getCanvas?.() ?? undefined;
    if (video === undefined || canvas === undefined) {
      throw new TypeError("capture_elements_unavailable");
    }
    return new MetadataOnlyCaptureRuntime(
      createBrowserCapturePlatform(video, canvas),
      options,
    );
  }
}
