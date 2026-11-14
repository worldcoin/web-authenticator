import { expect, spyOn, test } from "bun:test";
import { fetchEnrollmentChallenge } from "../lib/enrollment-challenge";

const ENDPOINT = "https://app.stage.orb.worldcoin.org/api/v4/zkp/challenge/enrollment";
const options = (signal = new AbortController().signal, endpoint = ENDPOINT) => ({ endpoint, signal });
const challenge = () => ({
  challenge_id: "01234567-89ab-4cde-8f01-23456789abcd",
  nonce: "0x" + "0".repeat(63) + "1",
  challenge_type: "enrollment" as const,
  expires_at: new Date(Date.now() + 600_000).toISOString(),
});

async function withFetch(
  respond: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<void>,
) {
  const mocked = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => respond(input, init)) as typeof fetch);
  try { await run(); } finally { mocked.mockRestore(); }
}

test("requests one enrollment challenge with an empty POST and preserves its wire values", async () => {
  const wire = challenge();
  let calls = 0;
  await withFetch((input, init) => {
    calls++;
    expect(String(input)).toBe(ENDPOINT);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(init?.body).toBeUndefined();
    expect([...new Headers(init?.headers)]).toEqual([]);
    expect(init?.signal?.aborted).toBe(false);
    return Response.json({ ...wire, future_metadata: true }, { status: 201 });
  }, async () => {
    expect(await fetchEnrollmentChallenge(options())).toEqual(wire);
  });
  expect(calls).toBe(1);
});

test("rejects unsafe or incorrect endpoints before fetching", async () => {
  let calls = 0;
  await withFetch(() => { calls++; return Response.json(challenge(), { status: 201 }); }, async () => {
    for (const endpoint of [
      "http://app.stage.orb.worldcoin.org/api/v4/zkp/challenge/enrollment",
      ENDPOINT + "?redirect=elsewhere", ENDPOINT + "#fragment", ENDPOINT + "/",
      ENDPOINT.replace("https://", "https://user:password@"),
      ENDPOINT.replace("enrollment", "teedi_migration"), "not a URL",
    ]) await expect(fetchEnrollmentChallenge(options(undefined, endpoint))).rejects.toBeInstanceOf(TypeError);
  });
  expect(calls).toBe(0);
});

test("allows loopback HTTP for local integration", async () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const endpoint = `http://${host}:4194/api/v4/zkp/challenge/enrollment`;
    await withFetch(input => {
      expect(String(input)).toBe(endpoint);
      return Response.json(challenge(), { status: 201 });
    }, async () => { await fetchEnrollmentChallenge(options(undefined, endpoint)); });
  }
});

test("surfaces HTTP failures without retrying or parsing arbitrary edge bodies", async () => {
  for (const status of [200, 302, 401, 429, 503]) {
    let calls = 0;
    await withFetch(() => { calls++; return new Response("edge error", { status }); }, async () => {
      await expect(fetchEnrollmentChallenge(options())).rejects.toMatchObject({ code: "http_error", status });
    });
    expect(calls).toBe(1);
  }
});

test("rejects malformed, expired and wrong-operation challenges", async () => {
  const wire = challenge();
  for (const value of [
    null, [], { ...wire, challenge_id: "not-a-uuid" },
    { ...wire, challenge_id: "00000000-0000-0000-0000-000000000000" },
    { ...wire, nonce: "1" }, { ...wire, challenge_type: "teedi_migration" },
    { ...wire, expires_at: "tomorrow" }, { ...wire, expires_at: "2000-01-01T00:00:00Z" },
    ...Object.keys(wire).map(key => ({ ...wire, [key]: undefined })),
  ]) {
    await withFetch(() => Response.json(value, { status: 201 }), async () => {
      await expect(fetchEnrollmentChallenge(options())).rejects.toMatchObject({ code: "invalid_response", status: 201 });
    });
  }
});

test("validates expiry after the body finishes arriving", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));
  const wire = challenge();
  try {
    await withFetch(() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(wire)));
        clock.mockReturnValue(Date.parse(wire.expires_at));
        controller.close();
      },
    }), { status: 201, headers: { "content-type": "application/json" } }), async () => {
      await expect(fetchEnrollmentChallenge(options())).rejects.toMatchObject({ code: "invalid_response" });
    });
  } finally { clock.mockRestore(); }
});

test("rejects invalid JSON, UTF-8, content types and absent bodies", async () => {
  for (const response of [
    new Response("{", { status: 201, headers: { "content-type": "application/json" } }),
    new Response(new Uint8Array([0xff]), { status: 201, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify(challenge()), { status: 201 }),
    new Response(null, { status: 201, headers: { "content-type": "application/json" } }),
  ]) {
    await withFetch(() => response, async () => {
      await expect(fetchEnrollmentChallenge(options())).rejects.toMatchObject({ code: "invalid_response" });
    });
  }
});

test("bounds chunked responses even without Content-Length and cancels the reader", async () => {
  let cancelled = false;
  await withFetch(() => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2048));
      controller.enqueue(new Uint8Array(2049));
    },
    cancel() { cancelled = true; },
  }), { status: 201, headers: { "content-type": "application/json" } }), async () => {
    await expect(fetchEnrollmentChallenge(options())).rejects.toMatchObject({ code: "invalid_response" });
  });
  expect(cancelled).toBe(true);
});

test("propagates caller cancellation before fetching, while fetching, and while reading", async () => {
  for (const stage of ["before", "fetch", "body"] as const) {
    const controller = new AbortController();
    const reason = new DOMException("Enrollment cancelled", "AbortError");
    let calls = 0;
    let cancelled = false;
    if (stage === "before") controller.abort(reason);
    await withFetch(() => {
      calls++;
      if (stage === "fetch") {
        controller.abort(reason);
        return new Promise<Response>(() => {});
      }
      return new Response(new ReadableStream({
        pull() { controller.abort(reason); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 }), { status: 201, headers: { "content-type": "application/json" } });
    }, async () => { await expect(fetchEnrollmentChallenge(options(controller.signal))).rejects.toBe(reason); });
    expect(calls).toBe(stage === "before" ? 0 : 1);
    if (stage === "body") expect(cancelled).toBe(true);
  }
});

test("the ten-second deadline covers fetching and stalled response bodies", async () => {
  for (const stage of ["fetch", "body"] as const) {
    const controller = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      expect(ms).toBe(10_000);
      return controller.signal;
    });
    try {
      await withFetch(() => {
        if (stage === "fetch") {
          controller.abort(new DOMException("deadline", "TimeoutError"));
          return new Promise<Response>(() => {});
        }
        return new Response(new ReadableStream({
          pull() { controller.abort(new DOMException("deadline", "TimeoutError")); },
        }, { highWaterMark: 0 }), { status: 201, headers: { "content-type": "application/json" } });
      }, async () => {
        await expect(fetchEnrollmentChallenge(options())).rejects.toMatchObject({ code: "request_timeout" });
      });
    } finally { timeout.mockRestore(); }
  }
});

test("surfaces network failures without retrying", async () => {
  let calls = 0;
  await withFetch(() => { calls++; throw new TypeError("Network unavailable"); }, async () => {
    await expect(fetchEnrollmentChallenge(options())).rejects.toMatchObject({ code: "request_failed" });
  });
  expect(calls).toBe(1);
});
