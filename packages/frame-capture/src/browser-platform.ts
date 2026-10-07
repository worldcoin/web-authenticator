import type {
  CaptureInterruptionReason,
  CapturePlatform,
  FrameSampler,
  OwnedMediaStream,
  TransientRgba8Frame,
} from "./types";
import type { SimulationCapturePolicyV0 } from "../../contracts/src";

function nextPresentedFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => resolve());
      return;
    }
    requestAnimationFrame(() => resolve());
  });
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const loaded = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("preview metadata unavailable"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("error", failed);
    };
    video.addEventListener("loadedmetadata", loaded, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

export function boundedRgbaDimensions(
  sourceWidth: number,
  sourceHeight: number,
  policy: SimulationCapturePolicyV0,
): { readonly width: number; readonly height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new RangeError("Invalid source dimensions");
  const maxPixels = Math.floor(policy.maxFrameBytes / 4);
  const scale = Math.min(
    1,
    policy.maxWidth / sourceWidth,
    policy.maxHeight / sourceHeight,
    Math.sqrt(maxPixels / (sourceWidth * sourceHeight)),
  );
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));
  return { width, height };
}

class CanvasFrameSampler implements FrameSampler {
  private readonly context: CanvasRenderingContext2D;
  private preparedWidth = 0;
  private preparedHeight = 0;
  private originalTransform: string;
  private interruptionListener?: (reason: CaptureInterruptionReason) => void;
  private listeningForResize = false;
  private disposed = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
    stream: OwnedMediaStream,
  ) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Canvas 2D unavailable");
    this.context = context;
    this.originalTransform = video.style.transform;
    video.style.transform = "scaleX(-1)";
    video.srcObject = stream as MediaStream;
  }

  setInterruptionListener(listener: (reason: CaptureInterruptionReason) => void): void {
    this.interruptionListener = listener;
  }

  async prepare(policy: SimulationCapturePolicyV0): Promise<void> {
    await waitForMetadata(this.video);
    if (this.disposed) throw new Error("Capture sampler disposed");
    await this.video.play();
    if (this.disposed) throw new Error("Capture sampler disposed");
    await nextPresentedFrame(this.video);
    if (this.disposed) throw new Error("Capture sampler disposed");
    this.preparedWidth = this.video.videoWidth;
    this.preparedHeight = this.video.videoHeight;
    const firstFrame = await this.sample(policy);
    firstFrame.bytes.fill(0);
    this.clear();
    if (this.disposed) throw new Error("Capture sampler disposed");
    this.video.addEventListener("resize", this.handleResize);
    this.listeningForResize = true;
  }

  async sample(policy: SimulationCapturePolicyV0): Promise<TransientRgba8Frame> {
    await nextPresentedFrame(this.video);
    if (this.disposed) throw new Error("Capture sampler disposed");
    const { width, height } = boundedRgbaDimensions(
      this.video.videoWidth,
      this.video.videoHeight,
      policy,
    );
    this.canvas.width = width;
    this.canvas.height = height;
    // Analysis coordinates are source-oriented. Mirroring is CSS preview-only.
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.drawImage(this.video, 0, 0, width, height);
    const image = this.context.getImageData(0, 0, width, height);
    this.context.clearRect(0, 0, width, height);
    return { width, height, bytes: image.data };
  }

  clear(): void {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.clear();
      this.canvas.width = 1;
      this.canvas.height = 1;
    } catch {
      // Continue detaching preview even if canvas release fails.
    }
    try {
      this.video.pause();
    } catch {
      // Continue detaching preview.
    }
    this.video.srcObject = null;
    this.video.removeAttribute("src");
    try {
      this.video.load();
    } catch {
      // The media source is already detached.
    }
    this.video.style.transform = this.originalTransform;
    if (this.listeningForResize) this.video.removeEventListener("resize", this.handleResize);
    this.interruptionListener = undefined;
  }

  private readonly handleResize = (): void => {
    if (
      this.video.videoWidth !== this.preparedWidth ||
      this.video.videoHeight !== this.preparedHeight
    ) {
      this.interruptionListener?.("orientation_change");
    }
  };
}

export function createBrowserCapturePlatform(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): CapturePlatform {
  return {
    requestCamera: (constraints) => {
      if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
        return Promise.reject({ name: "NotSupportedError" });
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    },
    createSampler: (stream) => new CanvasFrameSampler(video, canvas, stream),
    subscribeInterruptions: (listener) => {
      const visibility = () => {
        if (document.visibilityState !== "visible") listener("visibility_hidden");
      };
      const pagehide = () => listener("pagehide");
      const beforeunload = () => listener("beforeunload");
      const orientation = () => listener("orientation_change");
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("pagehide", pagehide);
      window.addEventListener("beforeunload", beforeunload);
      window.addEventListener("orientationchange", orientation);
      visibility();
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("pagehide", pagehide);
        window.removeEventListener("beforeunload", beforeunload);
        window.removeEventListener("orientationchange", orientation);
      };
    },
    nowMonotonicMs: () => performance.now(),
    nowEpochMs: () => Date.now(),
    setTimer: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimer: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}
