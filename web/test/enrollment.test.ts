import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { submitEnrollmentWithProof } from "../lib/enrollment";
import { ENROLLMENT_CONTEXT } from "../lib/enrollment-contract";
import { CAPTURE_ID, CHALLENGE_ID, enrollmentCapture, enrollmentChallenge } from "./fixtures/enrollment";

afterEach(() => mock.restore());

const options = () => ({
  endpoint: "https://app.stage.face.worldcoin.org/api/v2/identity",
  signal: new AbortController().signal,
});

function receipt() {
  return Response.json({
    sub: "0x1f", capture_id: CAPTURE_ID, polling_token: "AQ".repeat(21) + "A",
    polling_token_expires_at: new Date(Date.now() + 900_000).toISOString(),
  }, { status: 202 });
}

test("proof generation uses the enrollment context and attested subject before one submission", async () => {
  const capture = enrollmentCapture();
  const challenge = enrollmentChallenge();
  const proof = new Uint8Array([0xa1, 0x01, 0x02]);
  const wallet = { proveCredentialSub: mock(async () => proof), terminate: mock(() => {}) };
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(receipt());
  const result = await submitEnrollmentWithProof(wallet, capture, challenge, "0x02", options());
  expect(wallet.proveCredentialSub).toHaveBeenCalledWith(challenge.nonce, ENROLLMENT_CONTEXT, "0x02", "0x1f");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.captureId).toBe(CAPTURE_ID);
  const init = fetch.mock.calls[0][1]!;
  const body = init.body as FormData;
  expect(body.get("world_id_challenge_id")).toBe(CHALLENGE_ID);
  expect(new Uint8Array(await (body.get("world_id_ownership_proof") as File).arrayBuffer())).toEqual(proof);
  expect(wallet.terminate).not.toHaveBeenCalled();
});

test("proof generation snapshots attested fields before an async caller can mutate them", async () => {
  const original = enrollmentCapture();
  const capture = { ...original, fields: original.fields.map(field => ({ ...field })) };
  const wallet = {
    proveCredentialSub: mock(async () => {
      capture.fields.find(field => field.name === "sub")!.value = "0x2f";
      capture.attestation_header = btoa("replaced");
      return new Uint8Array([1]);
    }),
    terminate: mock(() => {}),
  };
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(receipt());
  await submitEnrollmentWithProof(wallet, capture, enrollmentChallenge(), "0x02", options());
  const init = fetch.mock.calls[0][1]!;
  expect((init.body as FormData).get("sub")).toBe("0x1f");
  expect(new Headers(init.headers).get("X-Nitro-Attestation")).toBe(original.attestation_header);
});

test("an invalid capture or challenge never starts proving or submission", async () => {
  const wallet = { proveCredentialSub: mock(async () => new Uint8Array([1])), terminate: mock(() => {}) };
  const fetch = spyOn(globalThis, "fetch");
  await expect(submitEnrollmentWithProof(wallet, enrollmentCapture(), { ...enrollmentChallenge(), challenge_type: "teedi_migration" }, "0x02", options())).rejects.toThrow("challenge");
  await expect(submitEnrollmentWithProof(wallet, { ...enrollmentCapture(), fields: [] }, enrollmentChallenge(), "0x02", options())).rejects.toThrow("bundle");
  expect(wallet.proveCredentialSub).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("a failed proof is propagated without submitting or retrying", async () => {
  const failure = new Error("proof rejected");
  const wallet = { proveCredentialSub: mock(async () => { throw failure; }), terminate: mock(() => {}) };
  const fetch = spyOn(globalThis, "fetch");
  await expect(submitEnrollmentWithProof(wallet, enrollmentCapture(), enrollmentChallenge(), "0x02", options())).rejects.toBe(failure);
  expect(wallet.proveCredentialSub).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  expect(wallet.terminate).not.toHaveBeenCalled();
});

test("aborting an active proof terminates its worker and never submits a late result", async () => {
  const controller = new AbortController();
  let finish!: (proof: Uint8Array) => void;
  const wallet = {
    proveCredentialSub: mock(() => new Promise<Uint8Array>(resolve => { finish = resolve; })),
    terminate: mock(() => {}),
  };
  const fetch = spyOn(globalThis, "fetch");
  const operation = submitEnrollmentWithProof(wallet, enrollmentCapture(), enrollmentChallenge(), "0x02", { ...options(), signal: controller.signal });
  controller.abort();
  await expect(operation).rejects.toThrow();
  finish(new Uint8Array([1]));
  await Promise.resolve();
  expect(wallet.terminate).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

test("an already cancelled operation leaves the wallet untouched", async () => {
  const wallet = { proveCredentialSub: mock(async () => new Uint8Array([1])), terminate: mock(() => {}) };
  const fetch = spyOn(globalThis, "fetch");
  await expect(submitEnrollmentWithProof(wallet, enrollmentCapture(), enrollmentChallenge(), "0x02", { ...options(), signal: AbortSignal.abort() })).rejects.toThrow();
  expect(wallet.proveCredentialSub).not.toHaveBeenCalled();
  expect(wallet.terminate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("a challenge that expires during proving is not submitted", async () => {
  const challenge = enrollmentChallenge();
  const expiredAt = Date.parse(challenge.expires_at);
  const wallet = {
    proveCredentialSub: mock(async () => {
      spyOn(Date, "now").mockReturnValue(expiredAt);
      return new Uint8Array([1]);
    }),
    terminate: mock(() => {}),
  };
  const fetch = spyOn(globalThis, "fetch");
  await expect(submitEnrollmentWithProof(wallet, enrollmentCapture(), challenge, "0x02", options())).rejects.toThrow("expired");
  expect(fetch).not.toHaveBeenCalled();
});
