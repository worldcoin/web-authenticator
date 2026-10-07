import {
  SIMULATION_CAPTURE_POLICY_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  type SimulationCapturePolicyV0,
} from "../../contracts/src";
import type {
  CaptureInterruptionReason,
  CapturePlatform,
  CaptureRequest,
  FrameSampler,
  OwnedMediaStream,
  OwnedMediaTrack,
  TransientRgba8Frame,
} from "../src";

export const ZERO_HASH = "0".repeat(64);
export const ONE_HASH = "1".repeat(64);

export const metadataPolicy: SimulationCapturePolicyV0 = {
  version: SIMULATION_CAPTURE_POLICY_V0,
  mode: SIMULATION_MODE,
  environment: SIMULATION_ENVIRONMENT,
  policyId: "capture-policy-test",
  dataMode: "metadata_only",
  encoding: "rgba8",
  minFrames: 1,
  maxFrames: 4,
  maxWidth: 4,
  maxHeight: 4,
  maxFrameBytes: 64,
  maxTotalBytes: 256,
  captureOffsetsAreDiagnosticOnly: true,
  arrayOrderHasBiometricMeaning: false,
  qualityPolicyId: "quality-policy-test",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

export class FakeTrack implements OwnedMediaTrack {
  stopCount = 0;
  facingMode?: string;
  settingsError?: unknown;
  private readonly listeners = new Map<string, Set<() => void>>();

  stop(): void {
    this.stopCount += 1;
  }

  getSettings(): { readonly facingMode?: string } {
    if (this.settingsError !== undefined) throw this.settingsError;
    return this.facingMode === undefined ? {} : { facingMode: this.facingMode };
  }

  addEventListener(type: "mute" | "ended", listener: () => void): void {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: "mute" | "ended", listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "mute" | "ended"): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

export class FakeStream implements OwnedMediaStream {
  readonly tracks = [new FakeTrack(), new FakeTrack()];

  getTracks(): readonly FakeTrack[] {
    return this.tracks;
  }
}

export class FakeSampler implements FrameSampler {
  prepareResult: Promise<void> = Promise.resolve();
  frames: TransientRgba8Frame[] = [];
  sampleOverride?: () => Promise<TransientRgba8Frame>;
  sampleCount = 0;
  clearCount = 0;
  disposeCount = 0;
  interruptionListener?: (reason: CaptureInterruptionReason) => void;

  prepare(): Promise<void> {
    return this.prepareResult;
  }

  sample(): Promise<TransientRgba8Frame> {
    this.sampleCount += 1;
    if (this.sampleOverride !== undefined) return this.sampleOverride();
    const frame = this.frames.shift();
    if (frame === undefined) return Promise.reject(new Error("no synthetic test frame"));
    return Promise.resolve(frame);
  }

  setInterruptionListener(listener: (reason: CaptureInterruptionReason) => void): void {
    this.interruptionListener = listener;
  }

  clear(): void {
    this.clearCount += 1;
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export class FakePlatform implements CapturePlatform {
  readonly stream = new FakeStream();
  readonly sampler = new FakeSampler();
  requestResult: Promise<OwnedMediaStream> = Promise.resolve(this.stream);
  requestCount = 0;
  constraints?: MediaStreamConstraints;
  interruptionListener?: (reason: CaptureInterruptionReason) => void;
  monotonic = 100;
  epoch = Date.parse("2026-09-02T12:00:00.000Z");
  private nextTimer = 0;
  readonly timers = new Map<number, { readonly callback: () => void; readonly delay: number }>();

  requestCamera(constraints: MediaStreamConstraints): Promise<OwnedMediaStream> {
    this.requestCount += 1;
    this.constraints = constraints;
    return this.requestResult;
  }

  createSampler(): FrameSampler {
    return this.sampler;
  }

  subscribeInterruptions(listener: (reason: CaptureInterruptionReason) => void): () => void {
    this.interruptionListener = listener;
    return () => {
      if (this.interruptionListener === listener) this.interruptionListener = undefined;
    };
  }

  nowMonotonicMs(): number {
    return this.monotonic++;
  }

  nowEpochMs(): number {
    return this.epoch;
  }

  setTimer(callback: () => void, delay: number): number {
    const handle = ++this.nextTimer;
    this.timers.set(handle, { callback, delay });
    return handle;
  }

  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  emit(reason: CaptureInterruptionReason): void {
    this.interruptionListener?.(reason);
  }

  fireShortestTimer(): void {
    const entry = [...this.timers.entries()].sort((left, right) => left[1].delay - right[1].delay)[0];
    if (entry !== undefined) {
      this.timers.delete(entry[0]);
      entry[1].callback();
    }
  }

  fireLongestTimer(): void {
    const entry = [...this.timers.entries()].sort((left, right) => right[1].delay - left[1].delay)[0];
    if (entry !== undefined) {
      this.timers.delete(entry[0]);
      entry[1].callback();
    }
  }
}

export function makeRequest(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    entry: {
      userActivated: true,
      secureTopLevelContextApproved: true,
      prfReady: true,
      iosMajor: 18,
      browser: "safari" as const,
    },
    policy: metadataPolicy,
    sessionId: "session-test",
    accountPublicMaterialDigestSha256: ZERO_HASH,
    nonceDigestSha256: ONE_HASH,
    ...overrides,
  };
}

export function testFrame(bytes = [0, 1, 2, 3]): TransientRgba8Frame {
  return { width: 1, height: 1, bytes: new Uint8ClampedArray(bytes) };
}

export async function nextTask(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20 && !predicate(); index += 1) await nextTask();
  if (!predicate()) throw new Error("Synthetic lifecycle did not reach the expected state");
}
