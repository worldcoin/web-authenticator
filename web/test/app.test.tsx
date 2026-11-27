import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AuthenticatorAppV1 } from "../App";
import { signedRequest } from "../../tests/integration/fixtures/request";
import { ENVIRONMENTS } from "../../config/environment";
import type { IncomingRequest } from "../lib/incoming-request";
import type { WalletKit, CredentialMetadata } from "../lib/walletkit";
import { RequestExpiredError } from "../lib/proof-request";
import { WalletBusyElsewhereError, WalletOpenError } from "../lib/wallet-errors";
import type { ConsentClient } from "../lib/consent";
import type { RequestWalletSession } from "../lib/wallet-session";
import * as capture from "../lib/selfie-capture";
import * as poseGuard from "../lib/poseguard/enrollment";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
/** A fake enrollment; `unresolved` is whether the issuer may hold a capture it has not issued yet. */
const fakeEnrollment = (run: poseGuard.RunPoseGuard, unresolved = () => false): poseGuard.PoseGuardEnrollment =>
  Object.assign(run, { hasUnresolvedSubmission: unresolved });
// Most tests are about other flows: consent is already decided, so the consent screen never renders.
const decidedConsent: ConsentClient = { read: async () => "denied", save: async choice => choice };
afterAll(() => GlobalRegistrator.unregister());
// Request flows live at /verify; the landing and authenticator tests visit their own paths.
const visit = (path: string) => window.history.replaceState(null, "", path);
beforeEach(() => visit("/verify"));
afterEach(() => { cleanup(); visit("/"); });

async function fixture(schema: number, available = false) {
  const { payload } = await signedRequest(schema);
  const credential = { credentialId: 1n, issuerSchemaId: BigInt(schema), isExpired: false, expiresAt: BigInt(Math.floor(Date.now()/1000)+3600), genesisIssuedAt: 0n } as CredentialMetadata;
  let records = available ? [credential] : [];
  const calls = { unlocked: 0, prove: 0, deliver: [] as string[], failDelivery: false, listed: 0, deleted: [] as bigint[], failDelete: false, terminated: 0 };
  const incoming: IncomingRequest = {
    proof: payload.proof_request, label: "rp_1",
    validate: async () => {}, cancel: async () => {},
    deliver: async proof => { calls.deliver.push(proof); if (calls.failDelivery) throw new Error("Transport unavailable"); },
  };
  const wallet = {
    listCredentials: async () => { calls.listed++; return records; },
    deleteCredential: async (id: bigint) => { calls.deleted.push(id); if (calls.failDelete) throw new Error("private worker error"); records = records.filter(record => record.credentialId !== id); },
    generateProof: async () => { calls.prove++; return JSON.stringify({ id: "test-request", responses: [{}] }); },
    terminate: () => { calls.terminated++; },
  } as unknown as WalletKit;
  // Aborting it is another tab taking the wallet.
  const takeover = new AbortController();
  Object.defineProperty(wallet, "takenOver", { value: takeover.signal });
  const services = {
    load: async (): Promise<IncomingRequest | null> => incoming,
    open: async () => wallet,
    unlock: async (): Promise<RequestWalletSession> => { calls.unlocked++; return session({ wallet }); },
  };
  function session(ready: { wallet: WalletKit } | { error: unknown }): RequestWalletSession {
    return { ready: Promise.resolve(ready), takenOver: takeover.signal, holdBusy: async () => () => {}, dispose: () => wallet.terminate() };
  }
  /** What a completed enrollment leaves in the wallet. */
  const issue = () => { records = [credential]; };
  return { services, calls, incoming, wallet, issue, takeover, session };
}
test("unsupported presence requirements stop before passkey setup", async () => {
  const f = await fixture(11); f.incoming.unsupportedReason = "User presence is not implemented.";
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(await view.findByText("User presence is not implemented.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Create or unlock with passkey" })).toBeNull();
  expect(view.queryByRole("button", { name: "Start check" })).toBeNull();
});

test("request intro names the RP only after validation, then starts the check", async () => {
  const f = await fixture(11); let opened = 0; let resolve!: (request: IncomingRequest) => void;
  f.services.load = () => new Promise(done => { resolve = done; });
  const open = f.services.open; f.services.open = async (...args) => { opened++; return open(...args); };
  window.history.replaceState(null, "", "/verify?t=wld&i=550e8400-e29b-41d4-a716-446655440000&k=a2V5");
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  // Load is pending: the RP is unverified, so it is not shown and the check cannot start.
  await view.findByRole("heading", { name: "Request from an app" });
  expect(window.location.search).toBe("");
  expect(view.queryByText("rp_1")).toBeNull();
  expect((view.getByRole("button", { name: "Verifying request…" }) as HTMLButtonElement).disabled).toBe(true);
  resolve(f.incoming);
  expect(await view.findByRole("heading", { name: "Request from rp_1" })).toBeTruthy();
  expect(view.getByRole("heading", { name: "App will receive" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  expect(await view.findByRole("region", { name: "Selfie capture" })).toBeTruthy();
  expect(opened).toBe(0);
  expect(f.calls.unlocked).toBe(1);
});
for (const [name, failure, title] of [
  ["expired", new RequestExpiredError("expired"), "This request has expired"],
  ["invalid", new Error("The RP request signature is invalid."), "This request can’t be verified"],
] as const) {
  test(`${name} requests end on the intro with no way to continue`, async () => {
    const f = await fixture(1); f.services.load = async () => { throw failure; };
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    expect(await view.findByRole("heading", { name: title })).toBeTruthy();
    expect(view.getByText("Close this tab and return to the app to start again.")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Start check" })).toBeNull();
    expect(view.queryByRole("button", { name: "Create or unlock with passkey" })).toBeNull();
    expect(view.queryByText(failure.message)).toBeNull();
  });
}
test("a request that expires on the intro stops offering the check", async () => {
  const f = await fixture(11);
  f.incoming.proof.expires_at = Math.ceil(Date.now() / 1000) + 1;
  f.incoming.returnUrl = "https://rp.example/done";
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(await view.findByRole("button", { name: "Continue" })).toBeTruthy();
  expect(await view.findByRole("heading", { name: "This request has expired" }, { timeout: 3000 })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(view.getByRole("link", { name: "Return to the app" }).getAttribute("href")).toBe("https://rp.example/done");
});

test("a first visit sees the consent screen before the home page, and the choice can be reopened", async () => {
  visit("/");
  const f = await fixture(1); f.services.load = async () => null;
  const saved: string[] = [];
  let state: "granted" | "denied" | "unset" = "unset";
  const consent: ConsentClient = { read: async () => state, save: async choice => { saved.push(choice); state = choice; return choice; } };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
  expect(view.getByText(/Never photos, face data, or account identifiers/)).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Your World ID, in this browser." })).toBeNull();
  expect(view.queryByRole("switch", { name: "Dev mode" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Accept" }));
  expect(await view.findByRole("heading", { name: "Your World ID, in this browser." })).toBeTruthy();
  expect(saved).toEqual(["granted"]);
  fireEvent.click(view.getByRole("button", { name: "Menu" }));
  fireEvent.click(view.getByRole("button", { name: "Cookie settings" }));
  fireEvent.click(await view.findByRole("button", { name: "Decline" }));
  expect(await view.findByRole("heading", { name: "Your World ID, in this browser." })).toBeTruthy();
  expect(saved).toEqual(["granted", "denied"]);
});

test("a request link waits behind consent, then shows the request before unlocking", async () => {
  const f = await fixture(11);
  const consent: ConsentClient = { read: async () => "unset", save: async choice => choice };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Decline" }));
  // The cookie choice only dismisses the cookie screen; the user still sees who is asking.
  expect(await view.findByRole("heading", { name: /^Request from / })).toBeTruthy();
  expect(f.calls.unlocked).toBe(0);
  fireEvent.click(await view.findByRole("button", { name: "Continue" }));
  expect(await view.findByRole("region", { name: "Selfie capture" })).toBeTruthy();
  expect(f.calls.unlocked).toBe(1);
});

test("a failed consent save keeps the consent screen with an error", async () => {
  const f = await fixture(1); f.services.load = async () => null;
  const consent: ConsentClient = { read: async () => "unset", save: async () => { throw new Error("offline"); } };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  fireEvent.click(await view.findByRole("button", { name: "Accept" }));
  expect(await view.findByText("Your choice couldn’t be saved. Try again.")).toBeTruthy();
  expect(view.getByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
});

test("unreadable consent storage asks again rather than assuming a choice", async () => {
  const f = await fixture(1); f.services.load = async () => null;
  const consent: ConsentClient = { read: async () => { throw new Error("offline"); }, save: async choice => choice };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
});

test("a request the wallet cannot answer enrolls a Selfie Check, then proves and delivers", async () => {
  const f = await fixture(11);
  f.incoming.returnUrl = "https://rp.example/done";
  const issuer = poseGuard.selfieIssuer("staging")!;
  let update!: Parameters<poseGuard.RunPoseGuard>[2];
  let finish!: (result: poseGuard.PoseGuardOutcome) => void;
  const outcome = new Promise<poseGuard.PoseGuardOutcome>(resolve => { finish = resolve; });
  const enrollment = spyOn(poseGuard, "createPoseGuardEnrollment").mockReturnValue(fakeEnrollment(async (_video, _signal, report) => {
    update = report;
    update({ phase: "framing", title: "Look straight", hint: "", progress: 0, cameraReady: true, target: null, poseStep: { index: 1, total: 4 } });
    return outcome;
  }));
  const captureMock = spyOn(capture, "captureSelfie").mockRejectedValue(new Error("Enrollment requires PoseGuard."));
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    expect(await view.findByRole("heading", { name: "Request from rp_1" })).toBeTruthy();
    expect(f.calls.unlocked).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    // Live guidance is a pill over the camera: no text above it, no step count, no icon while framing the centre.
    // The pill first shows the camera starting; the enrollment's first report replaces it.
    await waitFor(() => expect(view.getByTestId("selfie-guidance-pill").textContent).toBe("Look straight"));
    expect(view.getByTestId("selfie-guidance-pill").querySelector("svg")).toBeNull();
    expect(view.queryByRole("heading", { name: "Look straight" })).toBeNull();
    expect(view.queryByText(/Step \d of \d/)).toBeNull();
    expect(view.queryByTestId("pose-target-indicator")).toBeNull();
    expect(f.calls.unlocked).toBe(1);

    // Holding the centre is guidance, not loading: no spinner once the targets have arrived.
    act(() => update({ phase: "holding", title: "Hold steady", hint: "", progress: 0.12, cameraReady: true, target: null, poseStep: { index: 1, total: 4 } }));
    expect(view.getByTestId("selfie-guidance-pill").textContent).toBe("Hold steady");
    expect(view.getByTestId("selfie-guidance-pill").querySelector("svg")).toBeNull();
    act(() => {
      update({ phase: "captured", title: "Hold steady", hint: "", progress: 0.25,
        cameraReady: true, target: null, poseStep: { index: 1, total: 4 } });
      update({ phase: "framing", title: "Turn left", hint: "", progress: 0.25, cameraReady: true,
        target: { pitch: 0, yaw: 30 }, poseStep: { index: 2, total: 4 } });
    });
    // Nothing marks the moment a frame is taken.
    expect(view.queryByTestId("pose-capture-confirmation")).toBeNull();
    // The ring fills smoothly; the dots under the left bumper are left out so it sits on clean ring.
    const ring = view.getByTestId("selfie-design-ring");
    expect(ring.querySelectorAll('[data-filled="true"]')).toHaveLength(16);
    expect(ring.querySelectorAll("circle").length).toBeLessThan(64);
    // The pill's arrow points the same way as the bumper.
    expect(view.getByTestId("selfie-guidance-pill").textContent).toBe("Turn left");
    expect(view.getByTestId("selfie-guidance-pill").querySelector("svg")!.style.transform).toBe("rotate(270deg)");
    // A left turn puts the bumper and chevron at 270° on the ring; the bumper goes solid while the user holds.
    const indicator = view.getByTestId("pose-target-indicator");
    expect(indicator.dataset).toMatchObject({ angle: "270", aligned: "false" });
    expect(indicator.querySelector("path")!.getAttribute("stroke")).toBe("#c8e4fe");
    expect(indicator.querySelectorAll("path")[1]!.getAttribute("transform")).toMatch(/rotate\(270\.0\)$/);
    act(() => update({ phase: "holding", title: "Turn left", hint: "", progress: 0.3, cameraReady: true,
      target: { pitch: 0, yaw: 30 }, poseStep: { index: 2, total: 4 } }));
    expect(view.getByTestId("pose-target-indicator").dataset.aligned).toBe("true");
    expect(view.getByTestId("pose-target-indicator").querySelector("path")!.getAttribute("stroke")).toBe("currentColor");
    expect(view.queryByRole("heading", { name: "PoseGuard captures accepted" })).toBeNull();

    // Processing shows its message alone: no oval, ring or camera preview.
    act(() => update({ phase: "checking", title: "Processing liveness", hint: "This might take a few seconds", progress: 1, cameraReady: false }));
    expect(view.getByRole("heading", { name: "Processing liveness" })).toBeTruthy();
    expect(view.getByText("This might take a few seconds")).toBeTruthy();
    expect(view.getByTestId("processing-glyph")).toBeTruthy();
    expect(view.queryByTestId("selfie-guidance-pill")).toBeNull();
    expect(view.getByTestId("selfie-camera-stage").classList.contains("hidden")).toBe(true);

    f.issue();
    finish("completed");
    // The proof is created and sent while the same spinner runs.
    expect(await view.findByRole("heading", { name: "Credential received" })).toBeTruthy();
    const allSet = await view.findByTestId("all-set", undefined, { timeout: 3_000 });
    expect(view.getByRole("heading", { name: "You’re all set" })).toBeTruthy();
    expect([...allSet.querySelectorAll("a")].map(link => link.getAttribute("href"))).toContain("https://rp.example/done");
    expect(enrollment).toHaveBeenCalledTimes(1);
    expect(enrollment.mock.calls[0]![1]).toEqual(issuer);
    expect(captureMock).not.toHaveBeenCalled();
    expect(f.calls.deliver).toEqual([JSON.stringify({ id: "test-request", responses: [{}] })]);
    expect(f.calls.terminated).toBe(1);
  } finally {
    enrollment.mockRestore();
    captureMock.mockRestore();
  }
});

test("an environment issues Selfie Checks only when its configuration names an issuer", () => {
  expect(poseGuard.selfieIssuer("staging")).toEqual({
    policy: ENVIRONMENTS.staging.selfieEnrollment!, endpoint: "https://app.stage.face.worldcoin.org/api/v2/identity",
  });
  expect(ENVIRONMENTS.production.selfieEnrollment).toBeNull();
  expect(poseGuard.selfieIssuer("production")).toBeUndefined();
});

test.each(["saved", "replayed", "undelivered", "no issuer", "ineligible", "wallet failure"] as const)("a request answered without the camera: %s", async outcome => {
  const f = await fixture(11, outcome === "saved" || outcome === "replayed" || outcome === "undelivered");
  f.incoming.returnUrl = "https://rp.example/done";
  let declined = 0;
  f.incoming.cancel = async () => { declined++; };
  if (outcome === "replayed") {
    f.wallet.generateProof = async () => { throw Object.assign(new Error("nullifier_replay"), { name: "WalletKitError", code: "NullifierReplay" }); };
  }
  if (outcome === "undelivered") f.calls.failDelivery = true;
  // A Selfie credential outside the request's date bounds cannot be replaced by enrolling again.
  if (outcome === "ineligible") f.wallet.listCredentials = async () => [{ credentialId: 2n, issuerSchemaId: 11n, isExpired: false, expiresAt: 1n, genesisIssuedAt: 0n } as CredentialMetadata];
  if (outcome === "wallet failure") {
    f.services.unlock = async () => f.session({ error: new WalletOpenError("Registration is unavailable.") });
  }
  const issuer = spyOn(poseGuard, "selfieIssuer");
  if (outcome === "no issuer") issuer.mockReturnValue(undefined);
  const enrollment = spyOn(poseGuard, "createPoseGuardEnrollment");
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    if (outcome === "saved") {
      const allSet = await view.findByTestId("all-set", undefined, { timeout: 3_000 });
      expect([...allSet.querySelectorAll("a")].map(link => link.getAttribute("href"))).toContain("https://rp.example/done");
      expect(f.calls.deliver).toEqual([JSON.stringify({ id: "test-request", responses: [{}] })]);
    } else if (outcome === "replayed") {
      expect(await view.findByRole("heading", { name: "Proof already created" })).toBeTruthy();
      expect(f.calls.deliver).toEqual([]);
    } else if (outcome === "undelivered") {
      expect(await view.findByText("Could not send the proof. Try again.")).toBeTruthy();
      expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
    } else if (outcome === "wallet failure") {
      expect(await view.findByText("Registration is unavailable.")).toBeTruthy();
      expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
    } else {
      // Nothing can satisfy the request, so the app is told not to wait.
      expect(await view.findByRole("heading", { name: "This check can’t be completed here" })).toBeTruthy();
      expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
      await waitFor(() => expect(declined).toBe(1));
      expect(f.calls.prove).toBe(0);
    }
    expect(enrollment).not.toHaveBeenCalled();
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    expect(f.calls.terminated).toBe(1);
  } finally {
    issuer.mockRestore();
    enrollment.mockRestore();
  }
});

test("public non-Selfie requests stop before capture or wallet access", async () => {
  const f = await fixture(1);
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(await view.findByRole("heading", { name: "This request isn’t supported here" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(view.queryByRole("button", { name: /passkey|Approve/ })).toBeNull();
  expect(view.queryByRole("region", { name: "Selfie capture" }) === null).toBe(true);
  expect(f.calls.listed).toBe(0);
});

test("public cancellation closes the request even when the bridge is unavailable", async () => {
  const f = await fixture(11);
  f.incoming.cancel = async () => { throw new Error("offline"); };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  fireEvent.click(await view.findByRole("button", { name: "Cancel request" }));
  expect(await view.findByRole("heading", { name: "Check cancelled" })).toBeTruthy();
  expect(await view.findByText(/requesting app could not be notified/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(f.calls.prove).toBe(0);
});

test("a capture runs as busy, and another tab taking the wallet ends the request without answering the app", async () => {
  const f = await fixture(11);
  let cancelled = 0;
  f.incoming.cancel = async () => { cancelled++; };
  let busy = 0;
  f.services.unlock = async () => ({ ...f.session({ wallet: f.wallet }), holdBusy: async () => { busy++; return () => {}; } });
  const enrollment = spyOn(poseGuard, "createPoseGuardEnrollment").mockReturnValue(fakeEnrollment(() => new Promise(() => {})));
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    expect(await view.findByRole("region", { name: "Selfie capture" })).toBeTruthy();
    await waitFor(() => expect(busy).toBe(1));
    act(() => f.takeover.abort());
    expect(await view.findByRole("heading", { name: "Continued in another tab" })).toBeTruthy();
    expect(view.queryByRole("link", { name: "Return to the app" })).toBeNull();
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    expect(cancelled).toBe(0);
    expect(f.calls.deliver).toEqual([]);
    expect(f.calls.terminated).toBe(1);
  } finally { enrollment.mockRestore(); }
});

test("a pending enrollment keeps other tabs out until it resolves", async () => {
  const f = await fixture(11);
  const holds = { taken: 0, released: 0 };
  f.services.unlock = async () => ({ ...f.session({ wallet: f.wallet }), holdBusy: async () => { holds.taken++; return () => { holds.released++; }; } });
  const outcomes: poseGuard.PoseGuardOutcome[] = ["pending", "failed"];
  const enrollment = spyOn(poseGuard, "createPoseGuardEnrollment").mockReturnValue(fakeEnrollment(async () => outcomes.shift()!));
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    // Only this tab can store the credential of a submitted capture.
    const checkStatus = await view.findByRole("button", { name: "Check status" });
    expect(holds).toEqual({ taken: 1, released: 0 });
    fireEvent.click(checkStatus);
    await waitFor(() => expect(outcomes).toEqual([]));
    await waitFor(() => expect(holds).toEqual({ taken: 1, released: 1 }));
  } finally { enrollment.mockRestore(); }
});

for (const unresolved of [true, false]) {
  test(`a failed attempt ${unresolved ? "keeps" : "releases"} the busy hold when a submitted capture is ${unresolved ? "unresolved" : "resolved"}`, async () => {
    const f = await fixture(11);
    const holds = { taken: 0, released: 0 };
    f.services.unlock = async () => ({ ...f.session({ wallet: f.wallet }), holdBusy: async () => { holds.taken++; return () => { holds.released++; }; } });
    let attempts = 0;
    // The issuer accepted the capture, then its status read failed.
    const enrollment = spyOn(poseGuard, "createPoseGuardEnrollment").mockReturnValue(fakeEnrollment(async () => {
      attempts++; throw new Error("Status unavailable");
    }, () => unresolved));
    try {
      const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
      fireEvent.click(await view.findByRole("button", { name: "Continue" }));
      await waitFor(() => expect(attempts).toBe(1));
      await waitFor(() => expect(holds).toEqual({ taken: 1, released: unresolved ? 0 : 1 }));
      // Leaving ends the request and its hold either way.
      fireEvent.click(view.getByRole("button", { name: "Cancel check" }));
      await waitFor(() => expect(f.calls.terminated).toBe(1));
    } finally { enrollment.mockRestore(); }
  });
}

test("another tab taking the wallet while credentials load leaves sign-in available", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  try {
    const f = await fixture(11);
    f.wallet.listCredentials = () => new Promise(() => {});
    visit("/authenticator");
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Sign in with passkey" }));
    expect(await view.findByText("Loading your credentials…")).toBeTruthy();
    act(() => f.takeover.abort());
    expect(await view.findByText("Continued in another tab.")).toBeTruthy();
    expect(view.queryByText("Loading your credentials…")).toBeNull();
    expect(view.getByRole("button", { name: "Sign in with passkey" })).toBeTruthy();
  } finally { localStorage.clear(); }
});

test("a signed-in authenticator locks and says so when another tab takes the wallet", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  try {
    const f = await fixture(11);
    visit("/authenticator");
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Sign in with passkey" }));
    expect(await view.findByText("0 credentials in your authenticator.")).toBeTruthy();
    act(() => f.takeover.abort());
    expect(await view.findByText("Continued in another tab.")).toBeTruthy();
    expect(view.queryByText("0 credentials in your authenticator.")).toBeNull();
    expect(view.getByRole("button", { name: "Sign in with passkey" })).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
  } finally { localStorage.clear(); }
});

test("standalone creation opens a passkey wallet and offers the Selfie Check preview", async () => {
  localStorage.clear(); visit("/");
  const f = await fixture(11);
  let mode: string | undefined;
  const view = render(<AuthenticatorAppV1 services={{ ...f.services, open: async (_signal, _progress, selected) => {
    mode = selected;
    localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
    return f.wallet;
  } }} consent={decidedConsent} />);
  try {
    expect((await view.findByRole("button", { name: "Sign in with passkey" }) as HTMLButtonElement).disabled).toBe(false);
    expect((view.getByRole("button", { name: /Link an authenticator/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Create a new World ID" }));
    expect(await view.findByText("0 credentials in your authenticator.")).toBeTruthy();
    expect(mode).toBe("create");
    expect(view.getByText(/it won’t issue a credential/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Set up Selfie Check" }));
    expect(await view.findByRole("region", { name: "Selfie capture" })).toBeTruthy();
  } finally { localStorage.clear(); }
});

test("saved access requires explicit sign-in and shows credentials without starting camera", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  try {
    const f = await fixture(11);
    f.services.load = async () => null;
    visit("/");
    let opened = 0;
    const open = f.services.open;
    f.services.open = async () => { opened++; return open(); };
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    expect(await view.findByRole("heading", { name: "Your World ID, in this browser." })).toBeTruthy();
    expect(opened).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Sign in with passkey" }));
    expect(await view.findByText("0 credentials in your authenticator.")).toBeTruthy();
    expect(opened).toBe(1);
    expect(view.queryByRole("region", { name: "Selfie capture" }) === null).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Lock authenticator" }));
    expect(f.calls.terminated).toBe(1);
    expect(view.getByRole("button", { name: "Sign in with passkey" })).toBeTruthy();
  } finally { localStorage.clear(); }
});

test("an active Selfie Check does not offer setup", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  try {
    visit("/");
    const f = await fixture(11, true);
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Sign in with passkey" }));
    expect(await view.findByText("1 credential in your authenticator.")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Set up Selfie Check" })).toBeNull();
  } finally { localStorage.clear(); }
});

for (const mode of ["create", "open"] as const) {
  test(`${mode} shows progress until the wallet and credentials finish loading`, async () => {
    localStorage.clear();
    if (mode === "open") localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
    visit("/");
    const f = await fixture(11);
    let finishOpen!: (wallet: WalletKit) => void;
    let finishList!: (records: CredentialMetadata[]) => void;
    let reportProgress!: (message: string) => void;
    let terminated = 0;
    const wallet = { ...f.wallet, terminate: () => { terminated++; }, listCredentials: () => new Promise<CredentialMetadata[]>(resolve => { finishList = resolve; }) } as WalletKit;
    const view = render(<AuthenticatorAppV1 services={{ ...f.services, open: async (_signal, report) => {
      reportProgress = report;
      return new Promise<WalletKit>(resolve => { finishOpen = resolve; });
    } }} consent={decidedConsent} />);
    try {
      const action = mode === "open" ? "Sign in with passkey" : "Create a new World ID";
      const unavailable = mode === "open" ? "Create a new World ID" : "Sign in with passkey";
      expect((await view.findByRole("button", { name: unavailable }) as HTMLButtonElement).disabled).toBe(mode === "open");
      fireEvent.click(view.getByRole("button", { name: action }));
      expect(view.getByRole("status").textContent).toContain(mode === "open" ? "Use your passkey" : "Create your passkey");
      expect(view.queryByRole("button", { name: action })).toBeNull();
      expect(view.queryByRole("button", { name: unavailable })).toBeNull();
      expect(view.queryByRole("button", { name: /Link an authenticator/ })).toBeNull();
      act(() => reportProgress("internal registration progress"));
      expect(view.getByRole("status").textContent).toBe("Opening your authenticator…");
      await act(async () => { finishOpen(wallet); });
      expect(await view.findByText("Loading your credentials…")).toBeTruthy();
      await act(async () => { finishList([]); });
      expect(await view.findByText("0 credentials in your authenticator.")).toBeTruthy();
      await waitFor(() => expect(window.location.pathname).toBe("/authenticator"));
      expect(terminated).toBe(0);
      expect(view.getByRole("button", { name: "Lock authenticator" })).toBeTruthy();
      expect(view.queryByRole("status")).toBeNull();
    } finally { localStorage.clear(); }
  });
}

test("failed creation restores actions and offers sign-in when a passkey was saved", async () => {
  localStorage.clear(); visit("/");
  const f = await fixture(11);
  const view = render(<AuthenticatorAppV1 services={{ ...f.services, open: async () => {
    localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
    throw new Error("registration unavailable");
  } }} consent={decidedConsent} />);
  try {
    fireEvent.click(await view.findByRole("button", { name: "Create a new World ID" }));
    expect(await view.findByRole("alert")).toBeTruthy();
    expect(window.location.pathname).toBe("/");
    expect(view.queryByRole("status")).toBeNull();
    expect((view.getByRole("button", { name: "Sign in with passkey" }) as HTMLButtonElement).disabled).toBe(false);
    expect((view.getByRole("button", { name: "Create a new World ID" }) as HTMLButtonElement).disabled).toBe(true);
  } finally { localStorage.clear(); }
});

for (const [cause, expected] of [
  [new WalletOpenError("Wallet setup is already running in another tab."), "Wallet setup is already running in another tab."],
  [new WalletOpenError("Saved wallet metadata is invalid. Do not clear site data if you need this wallet."), "Saved wallet metadata is invalid. Do not clear site data if you need this wallet."],
  [new Error("private worker error"), "The encrypted wallet could not initialize. Try again."],
  [new WalletBusyElsewhereError(), "Your authenticator is busy with a check in another tab. Finish or cancel it there, then try again."],
  // WalletKit's worker gave up on the vault's file handle: a tab that did not hand the wallet over holds it.
  [Object.assign(new Error("PersistentStorage error: creating sync access handle: NoModificationAllowedError"), { code: "PersistentStorage" }),
    "Your authenticator is still open in another tab or window. Close it, then try again."],
] as const) {
  test(`wallet errors surface safe recovery guidance: ${expected}`, async () => {
    localStorage.clear(); visit("/");
    const f = await fixture(11);
    const view = render(<AuthenticatorAppV1 services={{ ...f.services, open: async () => { throw cause; } }} consent={decidedConsent} />);
    try {
      fireEvent.click(await view.findByRole("button", { name: "Create a new World ID" }));
      expect((await view.findByRole("alert")).textContent).toBe(expected);
      expect(view.queryByText("private worker error")).toBeNull();
    } finally { localStorage.clear(); }
  });
}

test("restoring a cached page reloads after its wallet session is terminated", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  visit("/authenticator");
  const f = await fixture(11);
  const reload = spyOn(window.location, "reload").mockImplementation(() => {});
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Sign in with passkey" }));
    await view.findByText("0 credentials in your authenticator.");
    fireEvent(window, new Event("pagehide"));
    expect(f.calls.terminated).toBe(1);
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    fireEvent(window, restored);
    expect(reload).toHaveBeenCalledTimes(1);
  } finally { reload.mockRestore(); localStorage.clear(); }
});
