import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { EnrollmentSession } from "../lib/enrollment-session";
import { finishEnrollment } from "../lib/enrollment";
import { CAPTURE_ID, enrollmentCapture, enrollmentChallenge } from "./fixtures/enrollment";

afterEach(() => mock.restore());

function fixture(unique = true) {
  const events: string[] = [];
  const wallet = {
    proveCredentialSub: mock(async () => { events.push("proof"); return new Uint8Array([1]); }),
    storeCredential: mock(async () => { events.push("store"); return { credentialId: 1n, issuerSchemaId: 11n }; }),
    terminate: mock(() => {}),
  };
  const session = { sub: "0x1f", blindingFactor: "0x02", wallet } as unknown as EnrollmentSession;
  const retain = {
    capture: mock(async () => { events.push("retain-capture"); }),
    receipt: mock(async () => { events.push("retain-receipt"); }),
  };
  const fetch = spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => {
    if (init?.method === "PUT") {
      events.push("submit");
      return Response.json({
        sub: session.sub, capture_id: CAPTURE_ID, polling_token: "AQ".repeat(21) + "A",
        polling_token_expires_at: new Date(Date.now() + 900_000).toISOString(),
      }, { status: 202 });
    }
    events.push("poll");
    return Response.json({ sub: session.sub, capture_id: CAPTURE_ID, status: "Completed", unique,
      ...(unique ? { credential: btoa("scored-credential") } : {}),
    });
  }) as typeof globalThis.fetch);
  return { events, wallet, session, retain, fetch,
    options: { endpoint: "https://app.stage.face.worldcoin.org/api/v2/identity", signal: new AbortController().signal },
  };
}

test("retains custody before submission and receipt before polling; stores issued bytes with the same factor", async () => {
  const f = fixture();
  const result = await finishEnrollment(f.session, enrollmentCapture(), enrollmentChallenge(), f.retain, f.options);
  expect(f.events).toEqual(["retain-capture", "proof", "submit", "retain-receipt", "poll", "store"]);
  expect(result.state).toBe("completed");
  expect(f.wallet.storeCredential).toHaveBeenCalledWith(new TextEncoder().encode("scored-credential"), "0x02");
});

test("a custody persistence failure prevents both proving and submission", async () => {
  const f = fixture();
  const failure = new Error("storage unavailable");
  f.retain.capture.mockRejectedValue(failure);
  await expect(finishEnrollment(f.session, enrollmentCapture(), enrollmentChallenge(), f.retain, f.options)).rejects.toBe(failure);
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.wallet.proveCredentialSub).not.toHaveBeenCalled();
});

test("a different subject is rejected before any side effect", async () => {
  const f = fixture();
  await expect(finishEnrollment({ ...f.session, sub: "0x2f" }, enrollmentCapture(), enrollmentChallenge(), f.retain, f.options)).rejects.toThrow("subject");
  expect(f.events).toEqual([]);
});

test("accepted submission with a receipt persistence failure surfaces its recovery condition and stops", async () => {
  const f = fixture();
  f.retain.receipt.mockRejectedValue(new Error("storage full"));
  await expect(finishEnrollment(f.session, enrollmentCapture(), enrollmentChallenge(), f.retain, f.options)).rejects.toThrow("was accepted");
  expect(f.events).toEqual(["retain-capture", "proof", "submit"]);
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test("a hard non-unique result retains custody and returns without storing a credential", async () => {
  const f = fixture(false);
  const result = await finishEnrollment(f.session, enrollmentCapture(), enrollmentChallenge(), f.retain, f.options);
  expect(result.state).toBe("duplicate");
  expect(f.wallet.storeCredential).not.toHaveBeenCalled();
  expect(f.retain.capture).toHaveBeenCalledTimes(1);
});

test("credential storage failure is surfaced without submitting enrollment again", async () => {
  const f = fixture();
  const failure = new Error("credential subject mismatch");
  f.wallet.storeCredential.mockRejectedValue(failure);
  await expect(finishEnrollment(f.session, enrollmentCapture(), enrollmentChallenge(), f.retain, f.options)).rejects.toBe(failure);
  expect(f.events.filter(event => event === "submit")).toHaveLength(1);
});
