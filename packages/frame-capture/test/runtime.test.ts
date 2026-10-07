import { describe, expect, test } from "bun:test";
import {
  CaptureRuntimeError,
  MetadataOnlyCaptureRuntime,
  type CaptureFailureCode,
} from "../src";
import {
  deferred,
  FakePlatform,
  FakeStream,
  makeRequest,
  metadataPolicy,
  nextTask,
  testFrame,
  waitUntil,
} from "./helpers";

describe("metadata-only capture runtime", () => {
  test("requires iOS 18+, approved top-level context, user action, and PRF before camera", async () => {
    const rejectedEntries = [
      { userActivated: false },
      { secureTopLevelContextApproved: false },
      { prfReady: false },
      { iosMajor: 17 },
    ];
    for (const override of rejectedEntries) {
      const platform = new FakePlatform();
      const runtime = new MetadataOnlyCaptureRuntime(platform);
      await expect(
        runtime.capture(
          makeRequest({ entry: { ...makeRequest().entry, ...override } }),
        ),
      ).rejects.toBeInstanceOf(CaptureRuntimeError);
      expect(platform.requestCount).toBe(0);
      expect(runtime.state).toBe("complete");
    }
  });

  test("uses W02's frozen Chrome product-cell name", async () => {
    const platform = new FakePlatform();
    platform.sampler.frames.push(testFrame());
    const runtime = new MetadataOnlyCaptureRuntime(platform);
    await expect(
      runtime.capture(
        makeRequest({ entry: { ...makeRequest().entry, browser: "chrome" } }),
      ),
    ).resolves.toMatchObject({ dataMode: "metadata_only" });
    expect(platform.requestCount).toBe(1);
  });

  test("rejects an explicitly non-user-facing camera and leaves unknown settings non-assertive", async () => {
    const rearPlatform = new FakePlatform();
    const rearTrack = rearPlatform.stream.tracks[0];
    if (rearTrack !== undefined) rearTrack.facingMode = "environment";
    const rearRuntime = new MetadataOnlyCaptureRuntime(rearPlatform);
    await expect(rearRuntime.capture(makeRequest())).rejects.toMatchObject({
      code: "non_user_facing_camera",
    });
    expect(rearPlatform.stream.tracks.every((track) => track.stopCount === 1)).toBe(true);
    expect(rearPlatform.sampler.disposeCount).toBe(0);

    const unknownPlatform = new FakePlatform();
    const unknownTrack = unknownPlatform.stream.tracks[0];
    if (unknownTrack !== undefined) unknownTrack.facingMode = "vendor-unknown";
    const unreadableTrack = unknownPlatform.stream.tracks[1];
    if (unreadableTrack !== undefined) unreadableTrack.settingsError = new Error("unreadable");
    unknownPlatform.sampler.frames.push(testFrame());
    await expect(
      new MetadataOnlyCaptureRuntime(unknownPlatform).capture(makeRequest()),
    ).resolves.toMatchObject({ dataMode: "metadata_only" });
  });

  test("acquires once, samples one-to-four frames, emits only descriptors, and cleans up", async () => {
    const platform = new FakePlatform();
    const first = testFrame([0, 1, 2, 3]);
    const second = testFrame([4, 5, 6, 7]);
    platform.sampler.frames.push(first, second);
    const states: string[] = [];
    const inspected: Uint8ClampedArray[] = [];
    const runtime = new MetadataOnlyCaptureRuntime(platform, {
      onStateChange: (state) => states.push(state),
    });
    const bundle = await runtime.capture(
      makeRequest({
        frameCount: 2,
        inspectTransientFrame: (frame) => {
          inspected.push(frame.bytes);
        },
      }),
    );

    expect(platform.requestCount).toBe(1);
    expect(platform.constraints).toEqual({
      audio: false,
      video: { facingMode: { ideal: "user" } },
    });
    expect(bundle.frames).toHaveLength(2);
    expect(bundle.frames.map((frame) => frame.transportIndex)).toEqual([0, 1]);
    expect(bundle.frames.map((frame) => frame.captureOffsetMs)).toEqual([1, 2]);
    expect(bundle.frames.every((frame) => frame.encoding === "rgba8")).toBe(true);
    expect(JSON.stringify(bundle)).not.toContain("bytes");
    expect(first.bytes.every((byte) => byte === 0)).toBe(true);
    expect(second.bytes.every((byte) => byte === 0)).toBe(true);
    expect(inspected.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(platform.stream.tracks.every((track) => track.stopCount === 1)).toBe(true);
    expect(platform.sampler.disposeCount).toBe(1);
    expect(states).toEqual([
      "permission_request",
      "acquiring",
      "awaiting_first_frame",
      "preview",
      "sampling",
      "artifact_ready",
      "cleaning_up",
      "complete",
    ]);
  });

  test("tombstones a cancelled permission request and stops its late stream", async () => {
    const platform = new FakePlatform();
    const camera = deferred<FakeStream>();
    platform.requestResult = camera.promise;
    const runtime = new MetadataOnlyCaptureRuntime(platform);
    const capture = runtime.capture(makeRequest());
    await nextTask();
    runtime.cancel();
    await expect(capture).rejects.toMatchObject({ code: "interrupted" });
    const lateStream = new FakeStream();
    camera.resolve(lateStream);
    await nextTask();
    expect(lateStream.tracks.every((track) => track.stopCount === 1)).toBe(true);
    expect(platform.sampler.disposeCount).toBe(0);
    expect(runtime.state).toBe("complete");
  });

  test("classifies acquisition errors without retaining underlying details", async () => {
    const cases: readonly [string, CaptureFailureCode][] = [
      ["NotAllowedError", "permission_denied"],
      ["NotFoundError", "camera_unavailable"],
      ["NotReadableError", "camera_busy"],
      ["SecurityError", "camera_restricted"],
      ["OverconstrainedError", "constraints_unsatisfied"],
      ["AbortError", "acquisition_aborted"],
      ["NotSupportedError", "camera_unsupported"],
      ["UnexpectedPrivateError", "unknown"],
    ];
    for (const [name, code] of cases) {
      const platform = new FakePlatform();
      platform.requestResult = Promise.reject({ name, secret: "raw-camera-secret" });
      const runtime = new MetadataOnlyCaptureRuntime(platform);
      try {
        await runtime.capture(makeRequest());
        throw new Error("expected capture rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(CaptureRuntimeError);
        expect((error as CaptureRuntimeError).code).toBe(code);
        expect(String(error)).not.toContain("raw-camera-secret");
      }
      expect(runtime.state).toBe("complete");
    }
  });

  test("classifies a hostile throwing error-name getter as unknown", async () => {
    const platform = new FakePlatform();
    const hostile = Object.defineProperty({}, "name", {
      get(): never {
        throw new Error("hostile getter detail");
      },
    });
    platform.requestResult = Promise.reject(hostile);
    await expect(
      new MetadataOnlyCaptureRuntime(platform).capture(makeRequest()),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(platform.requestCount).toBe(1);
  });

  test("first-frame watchdog stops all tracks and clears the sampler", async () => {
    const platform = new FakePlatform();
    platform.sampler.prepareResult = new Promise(() => undefined);
    const runtime = new MetadataOnlyCaptureRuntime(platform, { firstFrameTimeoutMs: 50 });
    const capture = runtime.capture(makeRequest());
    await waitUntil(() => runtime.state === "awaiting_first_frame");
    platform.fireShortestTimer();
    await expect(capture).rejects.toMatchObject({ code: "preview_timeout" });
    expect(platform.stream.tracks.every((track) => track.stopCount === 1)).toBe(true);
    expect(platform.sampler.clearCount).toBeGreaterThan(0);
    expect(platform.sampler.disposeCount).toBe(1);
  });

  test("permission timeout tombstones and clears a late stream", async () => {
    const platform = new FakePlatform();
    const camera = deferred<FakeStream>();
    platform.requestResult = camera.promise;
    const runtime = new MetadataOnlyCaptureRuntime(platform, { permissionTimeoutMs: 50 });
    const capture = runtime.capture(makeRequest());
    await waitUntil(() => platform.requestCount === 1);
    platform.fireShortestTimer();
    await expect(capture).rejects.toMatchObject({ code: "permission_timeout" });
    const lateStream = new FakeStream();
    camera.resolve(lateStream);
    await nextTask();
    expect(lateStream.tracks.every((track) => track.stopCount === 1)).toBe(true);
  });

  test("state observers cannot prevent cleanup", async () => {
    const platform = new FakePlatform();
    platform.sampler.frames.push(testFrame());
    const runtime = new MetadataOnlyCaptureRuntime(platform, {
      onStateChange: () => {
        throw new Error("observer failure");
      },
    });
    await expect(runtime.capture(makeRequest())).resolves.toMatchObject({
      dataMode: "metadata_only",
    });
    expect(platform.stream.tracks.every((track) => track.stopCount === 1)).toBe(true);
    expect(platform.sampler.disposeCount).toBe(1);
  });

  test("every observable interruption invalidates the attempt and releases resources", async () => {
    const reasons = [
      "visibility_hidden",
      "pagehide",
      "beforeunload",
      "orientation_change",
      "unmount",
    ] as const;
    for (const reason of reasons) {
      const platform = new FakePlatform();
      const pendingFrame = deferred<ReturnType<typeof testFrame>>();
      platform.sampler.sampleOverride = () => pendingFrame.promise;
      const runtime = new MetadataOnlyCaptureRuntime(platform);
      const capture = runtime.capture(makeRequest());
      await waitUntil(() => platform.sampler.sampleCount === 1);
      if (reason === "unmount") runtime.unmount();
      else platform.emit(reason);
      await expect(capture).rejects.toMatchObject({ code: "interrupted" });
      expect(platform.stream.tracks.every((track) => track.stopCount === 1)).toBe(true);
      expect(platform.sampler.disposeCount).toBe(1);
    }
  });

  test("clears a sampled frame that resolves after interruption", async () => {
    const platform = new FakePlatform();
    const pendingFrame = deferred<ReturnType<typeof testFrame>>();
    platform.sampler.sampleOverride = () => pendingFrame.promise;
    const runtime = new MetadataOnlyCaptureRuntime(platform);
    const capture = runtime.capture(makeRequest());
    await waitUntil(() => platform.sampler.sampleCount === 1);
    platform.emit("pagehide");
    await expect(capture).rejects.toMatchObject({ code: "interrupted" });
    const lateFrame = testFrame([20, 21, 22, 23]);
    pendingFrame.resolve(lateFrame);
    await nextTask();
    expect(lateFrame.bytes).toEqual(new Uint8ClampedArray(4));
  });

  test("track mute/end and session expiry are terminal and require a fresh attempt", async () => {
    for (const terminal of ["mute", "ended", "expiry"] as const) {
      const platform = new FakePlatform();
      platform.sampler.sampleOverride = () => new Promise(() => undefined);
      const runtime = new MetadataOnlyCaptureRuntime(platform);
      const capture = runtime.capture(makeRequest());
      await waitUntil(() => platform.sampler.sampleCount === 1);
      if (terminal === "expiry") platform.fireLongestTimer();
      else platform.stream.tracks[0]?.emit(terminal);
      await expect(capture).rejects.toMatchObject({
        code: terminal === "expiry" ? "session_expired" : "interrupted",
      });
      expect(platform.stream.tracks.every((track) => track.stopCount === 1)).toBe(true);
      expect(runtime.state).toBe("complete");
    }
  });

  test("zeros an owned frame when local inspection fails", async () => {
    const platform = new FakePlatform();
    const frame = testFrame([99, 98, 97, 96]);
    platform.sampler.frames.push(frame);
    const runtime = new MetadataOnlyCaptureRuntime(platform);
    await expect(
      runtime.capture(
        makeRequest({ inspectTransientFrame: () => Promise.reject(new Error("private")) }),
      ),
    ).rejects.toMatchObject({ code: "quality_callback_failed" });
    expect(frame.bytes).toEqual(new Uint8ClampedArray(4));
    expect(platform.stream.tracks.every((track) => track.stopCount === 1)).toBe(true);
  });

  test("sanitizes decorated CaptureRuntimeError values thrown by frame inspection", async () => {
    const platform = new FakePlatform();
    const frame = testFrame([211, 173, 199, 241]);
    platform.sampler.frames.push(frame);
    const decorated = Object.assign(new CaptureRuntimeError("unknown"), {
      pixels: [211, 173, 199, 241],
      copiedFrame: new Uint8ClampedArray([211, 173, 199, 241]),
    });
    decorated.message = "copied pixels: 211,173,199,241";

    try {
      await new MetadataOnlyCaptureRuntime(platform).capture(
        makeRequest({
          inspectTransientFrame: () => {
            throw decorated;
          },
        }),
      );
      throw new Error("expected sanitized callback rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(CaptureRuntimeError);
      const safeError = error as CaptureRuntimeError;
      expect(safeError).not.toBe(decorated);
      expect(safeError.code).toBe("quality_callback_failed");
      expect(safeError.message).toBe("The local capture guidance could not inspect the frame");
      expect(Object.keys(safeError).sort()).toEqual(["code", "name"]);
      expect("pixels" in safeError).toBe(false);
      expect("copiedFrame" in safeError).toBe(false);
      expect(JSON.stringify(safeError)).not.toContain("211");
      expect(String(safeError)).not.toContain("211");
    }
    expect(frame.bytes).toEqual(new Uint8ClampedArray(4));
    expect(platform.stream.tracks.every((track) => track.stopCount === 1)).toBe(true);
  });

  test("enforces frame count, dimensions, byte length, and total-byte bounds", async () => {
    const invalidRequests = [
      makeRequest({ frameCount: 0 }),
      makeRequest({ frameCount: 5 }),
      makeRequest({ policy: { ...metadataPolicy, maxTotalBytes: 3 } }),
    ];
    for (const request of invalidRequests) {
      const platform = new FakePlatform();
      platform.sampler.frames.push(testFrame());
      const runtime = new MetadataOnlyCaptureRuntime(platform);
      await expect(runtime.capture(request)).rejects.toMatchObject({ code: "artifact_limit" });
      expect(runtime.state).toBe("complete");
    }
  });
});
