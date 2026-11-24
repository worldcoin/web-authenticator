import { expect, spyOn, test } from "bun:test";
import { collectPoseGuardImages, poseDirection, type PoseFrame } from "../lib/poseguard/capture";
import { createPoseGuardEnrollment } from "../lib/poseguard/enrollment";
import type { PoseGuardCapture, PoseGuardPrompt } from "../lib/poseguard/types";
import type { EnrollmentReceipt } from "../lib/signup-service";
import type { RequestWalletSession } from "../lib/wallet-session";
import { CAPTURE_ID, CHALLENGE_ID, enrollmentCapture } from "./fixtures/enrollment";

const prompt: PoseGuardPrompt = {
  targets: [
    { targetPitch: 0, targetYaw: 30 },
    { targetPitch: 17, targetYaw: 0 },
    { targetPitch: 0, targetYaw: -30 },
  ],
  expiresAt: 0,
  captureTimeoutMs: 10_000,
};

function cameraFrames(pitch = -17) {
  // Include an out-of-tolerance frame before the final accepted image at each target.
  const readings = [
    [0, 0, 0], [600, 0, 0], [1200, 0, 0],
    [1300, -30, 0], [1400, 30, 0], [1700, 30, 0],
    [1800, 0, -pitch], [1900, 0, pitch], [2200, 0, pitch],
    [2300, 30, 0], [2400, -30, 0], [2700, -30, 0],
  ];
  const encoded: number[] = [];
  const released: number[] = [];
  let index = 0;
  const readFrame = async (): Promise<PoseFrame> => {
    const candidate = readings[index];
    if (!candidate) throw new Error("PoseGuard requested an unexpected frame.");
    const marker = index++;
    const [timestamp, yaw, pitch] = candidate;
    return {
      timestamp,
      pose: { yaw, pitch, left: 0.2, right: 0.8, top: 0.2, bottom: 0.8 },
      dimensions: { png: [758, 1080] },
      async png() { encoded.push(marker); return Uint8Array.of(marker); },
      release() { released.push(marker); },
    };
  };
  return { readFrame, encoded, released };
}

test.each([
  { issuedPitch: 17, direction: "up", degrees: 90 },
  { issuedPitch: -18, direction: "down", degrees: 270 },
])("captures the accepted frames in order for a $direction prompt", async ({ issuedPitch, direction, degrees }) => {
  const camera = cameraFrames(-issuedPitch);
  const challenge: PoseGuardPrompt = {
    ...prompt,
    targets: [prompt.targets[0], { targetPitch: issuedPitch, targetYaw: 0 }, prompt.targets[2]],
  };
  const directions: string[] = [];
  const confirmations: number[] = [];
  const images = await collectPoseGuardImages(challenge, new AbortController().signal, camera.readFrame, state => {
    if (state.phase === "captured") {
      confirmations.push(state.poseStep!.index);
      expect(camera.encoded).toHaveLength(confirmations.length);
      expect(state.progress).toBe(confirmations.length / 4);
    }
    if (state.phase !== "framing" || state.poseStep?.index !== directions.length + 1) return;
    expect(state.poseStep.total).toBe(4);
    if (state.poseStep.index === 3) {
      expect(state.target).toEqual({ pitch: -issuedPitch, yaw: 0 });
      expect(poseDirection(state.target!)).toEqual({ label: direction, degrees });
    }
    directions.push(state.title);
  });
  expect(directions).toEqual(["Look straight ahead", "Turn your head left", `Turn your head ${direction}`, "Turn your head right"]);
  expect([images.centralPng, ...images.captures].map(frame => frame[0])).toEqual([2, 5, 8, 11]);
  expect(camera.encoded).toEqual([2, 5, 8, 11]);
  expect(confirmations).toEqual([1, 2, 3, 4]);
  expect(camera.released).toHaveLength(12);
});

test.each([
  { label: "two targets", targets: prompt.targets.slice(0, 2) },
  { label: "a yaw beyond 35°", targets: [{ targetPitch: 0, targetYaw: 36 }, ...prompt.targets.slice(1)] },
  { label: "a pitch beyond 20°", targets: [{ targetPitch: -21, targetYaw: 0 }, ...prompt.targets.slice(1)] },
  { label: "a centred target", targets: [{ targetPitch: 0, targetYaw: 0 }, ...prompt.targets.slice(1)] },
  { label: "a non-finite angle", targets: [{ targetPitch: Number.NaN, targetYaw: 30 }, ...prompt.targets.slice(1)] },
  { label: "no capture time", targets: prompt.targets, captureTimeoutMs: 0 },
])("rejects a prompt with $label before reading the camera", async ({ targets, captureTimeoutMs = prompt.captureTimeoutMs }) => {
  let reads = 0;
  // Deliberately outside the WalletKit prompt type: this is what the runtime check guards against.
  const invalid = { ...prompt, targets, captureTimeoutMs } as unknown as PoseGuardPrompt;
  await expect(collectPoseGuardImages(invalid, new AbortController().signal, async () => {
    reads++;
    throw new Error("The camera must not be read.");
  }, () => {})).rejects.toThrow("WalletKit supplied an invalid PoseGuard prompt.");
  expect(reads).toBe(0);
});

test.each([
  { label: "center face is too small in the crop", timestamp: 1200, relativeWidth: 0.5, png: [758, 1080], step: 1, encoded: [] },
  { label: "target face is below the pixel floor", timestamp: 1700, relativeWidth: 0.6, png: [180, 255], step: 2, encoded: [2] },
] as const)("asks the user to move closer when the $label", async ({ timestamp, relativeWidth, png, step, encoded }) => {
  const camera = cameraFrames();
  const controller = new AbortController();
  const stop = new Error("Received distance guidance");
  await expect(collectPoseGuardImages(prompt, controller.signal, async () => {
    const frame = await camera.readFrame();
    if (frame.timestamp !== timestamp || !frame.pose) return frame;
    const left = (1 - relativeWidth) / 2;
    return { ...frame, pose: { ...frame.pose, left, right: 1 - left }, dimensions: { png } };
  }, state => {
    if (state.hint !== "Move closer to the camera.") return;
    expect(state.phase).toBe("framing");
    expect(state.poseStep?.index).toBe(step);
    expect(state.progress).toBe((step - 1) / 4);
    controller.abort(stop);
  })).rejects.toBe(stop);
  expect(camera.encoded).toEqual([...encoded]);
});

test.each([
  { label: "production", mode: "production", saveCredential: false },
  { label: "test", mode: "test", saveCredential: false },
  { label: "production with saved credential", mode: "production", saveCredential: true },
  { label: "staging", mode: "staging", saveCredential: true },
] as const)("submits $label evidence once and resumes from the matching receipt", async ({ mode, saveCredential }) => {
  const capture = enrollmentCapture();
  const camera = cameraFrames();
  const request = new AbortController();
  const bundle = {
    fields: capture.fields.map(field => ({ ...field })),
    attestationHeader: capture.attestation_header,
    encryptedCustody: Uint8Array.of(10, 11),
  };
  const proof = Uint8Array.of(0xa1, 0x01, 0x02);
  let puts = 0;
  let polls = 0;
  let sdkCalls = 0;
  let authorizationCalls = 0;
  let stored = 0;
  const submitted: { header: string | null; body?: FormData } = { header: null };
  const polledSubjects: (string | null)[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(incoming) {
      const url = new URL(incoming.url);
      if (url.pathname !== "/api/v2/identity") return new Response(null, { status: 404 });
      if (incoming.method === "PUT") {
        puts++;
        submitted.header = incoming.headers.get("X-Nitro-Attestation");
        submitted.body = await incoming.formData();
        return Response.json({}, { status: 202 });
      }
      polls++;
      polledSubjects.push(url.searchParams.get("sub"));
      if (polls === 1) return Response.json({}, { status: 503 });
      return Response.json({
        status: "VERIFIED",
        enrollment_status: { capture_id: CAPTURE_ID, status: "ENROLLMENT_UNIQUE_SUCCESSFUL", credential: "AQI=" },
      });
    },
  });
  try {
    const wallet = {
      async prepareCredential(schema: bigint) {
        expect(schema).toBe(11n);
        return { sub: "0x1f", blindingFactor: "0x2f" };
      },
      async storeCredential(bytes: Uint8Array, factor: string, _now: unknown, schema: bigint) {
        expect([...bytes]).toEqual([1, 2]);
        expect(factor).toBe("0x2f");
        expect(schema).toBe(11n);
        stored++;
      },
      async enrollSelfieWithPoseGuard(_config: string, sub: string, key: Uint8Array, capture: PoseGuardCapture, signal: AbortSignal) {
        sdkCalls++;
        expect(sub).toBe("0x1f");
        expect(key.byteLength).toBe(32);
        const captured = await capture(prompt, signal);
        expect([captured.centralPng, ...captured.captures].map(frame => frame[0])).toEqual([2, 5, 8, 11]);
        return { status: "success", enrollment: bundle } as const;
      },
    };
    const session = { ready: Promise.resolve({ wallet }), dispose() {} } as unknown as RequestWalletSession;
    const authorize = async (identity: EnrollmentReceipt) => {
      authorizationCalls++;
      expect(identity).toEqual({ sub: "0x1f", captureId: CAPTURE_ID });
      return { challengeId: CHALLENGE_ID, proofCbor: proof };
    };
    const signup = mode === "production" ? { mode, authorize, saveCredential: saveCredential ? true as const : undefined } : { mode };
    const run = createPoseGuardEnrollment(session, {
      policy: { endpoint: "wss://tee.test", releases: [] },
      endpoint: new URL("/api/v2/identity", server.url).href,
      ...signup,
    }, request.signal, async (_video, signal) => ({ signal, close() {}, readFrame: camera.readFrame }));
    const video = {} as HTMLVideoElement;
    const signal = new AbortController().signal;
    await expect(run(video, signal, () => {})).rejects.toThrow("HTTP 503");
    const checkingTitles = new Set<string>();
    await expect(run(video, signal, state => { if (state.phase === "checking") checkingTitles.add(state.title); })).resolves.toBe("completed");
    // The resumed run polls and saves; neither step is named on screen.
    expect([...checkingTitles]).toEqual(["Processing liveness"]);
    expect({ puts, polls, sdkCalls, authorizationCalls }).toEqual({ puts: 1, polls: 2, sdkCalls: 1, authorizationCalls: mode === "production" ? 1 : 0 });
    expect(stored).toBe(saveCredential ? 1 : 0);
    if (saveCredential) await expect(run(video, signal, () => {})).resolves.toBe("completed");
    expect(puts).toBe(1);
    expect(polls).toBe(2);
    expect(stored).toBe(saveCredential ? 1 : 0);
    expect(polledSubjects).toEqual(["0x1f", "0x1f"]);
    expect(submitted.header).toBe(mode === "test" ? btoa("poseguard test attestation") : capture.attestation_header);
    for (const { name, value } of capture.fields) expect(submitted.body?.get(name)).toBe(value);
    const sentChallenge = submitted.body?.get("world_id_challenge_id");
    const sentProof = submitted.body?.get("world_id_ownership_proof");
    if (mode === "staging") {
      expect(sentChallenge).toBeNull();
      expect(sentProof).toBeNull();
    } else {
      expect(sentChallenge).toBe(mode === "production" ? CHALLENGE_ID : "00000000-0000-4000-8000-000000000001");
      expect(sentProof).toBeInstanceOf(File);
      expect(new Uint8Array(await (sentProof as File).arrayBuffer())).toEqual(mode === "production" ? Uint8Array.of(0xa1, 0x01, 0x02) : Uint8Array.of(0xa0));
    }
    expect(bundle.encryptedCustody).toEqual(new Uint8Array(2));
  } finally {
    await server.stop(true);
  }
});

test.each(["succeeds", "fails"] as const)("resumes a credential save that %s after its wait times out", async outcome => {
  const camera = cameraFrames();
  const capture = enrollmentCapture();
  const write = Promise.withResolvers<void>();
  const deadline = new AbortController();
  const originalTimeout = AbortSignal.timeout;
  let saveWaits = 0;
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(ms =>
    ms === 30_000 && saveWaits++ === 0 ? deadline.signal : originalTimeout(ms),
  );
  let puts = 0;
  let polls = 0;
  let writes = 0;
  let credentialBytes: Uint8Array | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(incoming) {
      if (incoming.method === "PUT") {
        puts++;
        return Response.json({}, { status: 202 });
      }
      polls++;
      return Response.json({
        status: "VERIFIED",
        enrollment_status: { capture_id: CAPTURE_ID, status: "ENROLLMENT_UNIQUE_SUCCESSFUL", credential: "AQI=" },
      });
    },
  });
  try {
    const wallet = {
      async prepareCredential() { return { sub: "0x1f", blindingFactor: "0x2f" }; },
      async enrollSelfieWithPoseGuard(_config: string, _sub: string, _key: Uint8Array, capturePose: PoseGuardCapture, signal: AbortSignal) {
        await capturePose(prompt, signal);
        return {
          status: "success",
          enrollment: { fields: capture.fields, attestationHeader: capture.attestation_header, encryptedCustody: Uint8Array.of(1) },
        } as const;
      },
      async storeCredential(bytes: Uint8Array) {
        writes++;
        credentialBytes = bytes;
        queueMicrotask(() => deadline.abort(new DOMException("Save wait timed out", "TimeoutError")));
        await write.promise;
      },
    };
    const session = { ready: Promise.resolve({ wallet }), dispose() {} } as unknown as RequestWalletSession;
    const signal = new AbortController().signal;
    const run = createPoseGuardEnrollment(session, {
      policy: { endpoint: "wss://tee.test", releases: [] },
      endpoint: new URL("/api/v2/identity", server.url).href,
      mode: "staging",
    }, signal, async (_video, signal) => ({ signal, close() {}, readFrame: camera.readFrame }));
    const attempt = () => run({} as HTMLVideoElement, signal, () => {});

    await expect(attempt()).resolves.toBe("pending");
    expect(credentialBytes).toEqual(Uint8Array.of(1, 2));

    if (outcome === "succeeds") {
      const retry = attempt();
      write.resolve();
      await expect(retry).resolves.toBe("completed");
      await expect(attempt()).resolves.toBe("completed");
    } else {
      const error = new Error("The wallet rejected the save");
      write.reject(error);
      await Bun.sleep(0);
      await expect(attempt()).rejects.toBe(error);
    }
    expect({ puts, polls, writes }).toEqual({ puts: 1, polls: 1, writes: 1 });
    expect(credentialBytes).toEqual(new Uint8Array(2));
  } finally {
    timeout.mockRestore();
    write.resolve();
    await server.stop(true);
  }
});

test.each([
  { name: "a tree that never includes the leaf", code: "invalid_leaf_index", message: "Leaf index out of range.", syncsOn: 0, attempts: 3, rejection: "World ID is syncing.", waits: true },
  { name: "an insertion that stays pending", code: "locked", message: "Insertion is still pending.", syncsOn: 0, attempts: 3, rejection: "World ID is syncing.", waits: true },
  { name: "a non-sync indexer error", code: "invalid_leaf_index", message: "Leaf index cannot be 0.", syncsOn: 0, attempts: 1, rejection: "Leaf index cannot be 0.", waits: false },
  { name: "a tree that catches up on the third attempt", code: "invalid_leaf_index", message: "Leaf index out of range.", syncsOn: 3, attempts: 3, rejection: "Camera must wait for enrollment preparation.", waits: true },
])("bounds enrollment preparation retries for $name", async ({ code, message, syncsOn, attempts, rejection, waits }) => {
  const body = JSON.stringify({ code, message });
  const error = Object.assign(new Error(`network_error at indexer: ${body} (NetworkError { status: Some(400) })`), {
    name: "WalletKitError", code: "NetworkError",
  });
  let preparations = 0;
  const session = {
    ready: Promise.resolve({ wallet: { async prepareCredential() {
      if (++preparations === syncsOn) return { sub: "0x1", blindingFactor: "0x2" };
      throw error;
    } } }),
    dispose() {},
  } as unknown as RequestWalletSession;
  const signal = new AbortController().signal;
  const updates: string[] = [];
  const run = createPoseGuardEnrollment(session, {
    policy: { endpoint: "wss://tee.test", releases: [] },
    endpoint: "https://signup.test/api/v2/identity",
    mode: "test",
  }, signal, async () => { throw new Error("Camera must wait for enrollment preparation."); }, [0, 0]);

  await expect(run({} as HTMLVideoElement, signal, state => updates.push(state.title))).rejects.toThrow(rejection);
  expect(preparations).toBe(attempts);
  expect(updates.includes("Waiting for your World ID to sync")).toBe(waits);
});

test.each([
  { result: { status: "failed", reason: "quality_rejected" }, message: "Center frame failed the quality check." },
  { result: { status: "failed", reason: "challenge", index: 0, challengeReason: "quality_rejected" }, message: "Capture rejected at step 2." },
  { result: { status: "failed", reason: "challenge", index: 1, challengeReason: "quality_rejected" }, message: "Capture rejected at step 3." },
] as const)("reports $message before authorizing submission", async ({ result, message }) => {
  const camera = cameraFrames();
  const signal = new AbortController().signal;
  const wallet = {
    async prepareCredential() { return { sub: "0x1f", blindingFactor: "0x2f" }; },
    async enrollSelfieWithPoseGuard(_config: string, _sub: string, _key: Uint8Array, capture: PoseGuardCapture, signal: AbortSignal) {
      await capture(prompt, signal);
      return result;
    },
  };
  const session = { ready: Promise.resolve({ wallet }), dispose() {} } as unknown as RequestWalletSession;
  const run = createPoseGuardEnrollment(session, {
    policy: { endpoint: "wss://tee.test", releases: [] },
    endpoint: "https://signup.test/api/v2/identity",
    mode: "production",
    async authorize() { throw new Error("The rejected batch cannot be submitted."); },
  }, signal, async (_video, signal) => ({ signal, close() {}, readFrame: camera.readFrame }));

  await expect(run({} as HTMLVideoElement, signal, () => {})).rejects.toThrow(message);
});
