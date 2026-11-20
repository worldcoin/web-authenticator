import { expect, test } from "bun:test";
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
      pose: { yaw, pitch, left: 0.25, right: 0.75, top: 0.2, bottom: 0.8 },
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
  const images = await collectPoseGuardImages(challenge, new AbortController().signal, camera.readFrame, state => {
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
  expect(camera.released).toHaveLength(12);
});

test.each([
  { mode: "verified", testMode: false, saveCredential: false },
  { mode: "test", testMode: true, saveCredential: false },
  { mode: "verified demo", testMode: false, saveCredential: true },
])("submits $mode evidence once and resumes from the matching receipt", async ({ testMode, saveCredential }) => {
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
    const run = createPoseGuardEnrollment(session, {
      policy: { endpoint: "wss://tee.test", releases: [] },
      endpoint: new URL("/api/v2/identity", server.url).href,
      ...(testMode ? { testMode } : { testMode, authorize, saveCredential: saveCredential ? true : undefined }),
    }, request.signal, async (_video, signal) => ({ signal, close() {}, readFrame: camera.readFrame }));
    const video = {} as HTMLVideoElement;
    const signal = new AbortController().signal;
    await expect(run(video, signal, () => {})).rejects.toThrow("HTTP 503");
    await expect(run(video, signal, () => {})).resolves.toBe("completed");
    expect({ puts, polls, sdkCalls, authorizationCalls }).toEqual({ puts: 1, polls: 2, sdkCalls: 1, authorizationCalls: testMode ? 0 : 1 });
    expect(stored).toBe(saveCredential ? 1 : 0);
    if (saveCredential) await expect(run(video, signal, () => {})).resolves.toBe("completed");
    expect(puts).toBe(1);
    expect(polls).toBe(2);
    expect(stored).toBe(saveCredential ? 1 : 0);
    expect(polledSubjects).toEqual(["0x1f", "0x1f"]);
    expect(submitted.header).toBe(testMode ? btoa("poseguard test attestation") : capture.attestation_header);
    for (const { name, value } of capture.fields) expect(submitted.body?.get(name)).toBe(value);
    expect(submitted.body?.get("world_id_challenge_id")).toBe(testMode ? "00000000-0000-4000-8000-000000000001" : CHALLENGE_ID);
    const sentProof = submitted.body?.get("world_id_ownership_proof");
    expect(sentProof).toBeInstanceOf(File);
    expect(new Uint8Array(await (sentProof as File).arrayBuffer())).toEqual(testMode ? Uint8Array.of(0xa0) : Uint8Array.of(0xa1, 0x01, 0x02));
    expect(bundle.encryptedCustody).toEqual(new Uint8Array(2));
  } finally {
    await server.stop(true);
  }
});

test.each([
  { message: "Leaf index out of range.", attempts: 2, hint: "The staging indexer could not find your account in its proof tree yet." },
  { message: "Leaf index cannot be 0.", attempts: 1, hint: "Leaf index cannot be 0." },
])("bounds enrollment preparation retries for $message", async ({ message, attempts, hint }) => {
  const body = JSON.stringify({ code: "invalid_leaf_index", message });
  const error = Object.assign(new Error(`network_error at indexer: ${body} (NetworkError { status: Some(400) })`), {
    name: "WalletKitError", code: "NetworkError",
  });
  let preparations = 0;
  const session = {
    ready: Promise.resolve({ wallet: { async prepareCredential() { preparations++; throw error; } } }),
    dispose() {},
  } as unknown as RequestWalletSession;
  const signal = new AbortController().signal;
  const updates: string[] = [];
  const run = createPoseGuardEnrollment(session, {
    policy: { endpoint: "wss://tee.test", releases: [] },
    endpoint: "https://signup.test/api/v2/identity",
    testMode: true,
  }, signal, async () => { throw new Error("Camera must wait for enrollment preparation."); });

  await expect(run({} as HTMLVideoElement, signal, state => updates.push(state.title))).rejects.toThrow(hint);
  expect(preparations).toBe(attempts);
  expect(updates.includes("Waiting for your World ID to sync")).toBe(attempts === 2);
});

test("reports a center quality rejection before authorizing submission", async () => {
  const camera = cameraFrames();
  const signal = new AbortController().signal;
  const wallet = {
    async prepareCredential() { return { sub: "0x1f", blindingFactor: "0x2f" }; },
    async enrollSelfieWithPoseGuard(_config: string, _sub: string, _key: Uint8Array, capture: PoseGuardCapture, signal: AbortSignal) {
      await capture(prompt, signal);
      return { status: "failed", reason: "quality_rejected" } as const;
    },
  };
  const session = { ready: Promise.resolve({ wallet }), dispose() {} } as unknown as RequestWalletSession;
  const run = createPoseGuardEnrollment(session, {
    policy: { endpoint: "wss://tee.test", releases: [] },
    endpoint: "https://signup.test/api/v2/identity",
    testMode: false,
    async authorize() { throw new Error("The rejected batch cannot be submitted."); },
  }, signal, async (_video, signal) => ({ signal, close() {}, readFrame: camera.readFrame }));

  await expect(run({} as HTMLVideoElement, signal, () => {})).rejects.toThrow("The center frame did not pass");
});
