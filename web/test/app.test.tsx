import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AuthenticatorAppV1 } from "../App";
import { bridgeId, signedRequest } from "../../tests/integration/fixtures/request";
import { DEMO_PATH } from "../../config/demo";
import { ENVIRONMENTS } from "../../config/environment";
import type { IncomingRequest } from "../lib/incoming-request";
import type { WalletKit, CredentialMetadata } from "../lib/walletkit";
import { RequestExpiredError } from "../lib/proof-request";
import { WalletOpenError } from "../lib/wallet-errors";
import type { ConsentClient } from "../lib/consent";
import type { RequestWalletSession } from "../lib/wallet-session";
import * as capture from "../lib/selfie-capture";
import * as demo from "../lib/demo";
import * as demoEnrollment from "../lib/demo-enrollment";
import * as poseGuard from "../lib/poseguard/enrollment";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
// Most tests are about other flows: consent is already decided, so the consent screen never renders.
const decidedConsent: ConsentClient = { read: async () => "denied", save: async choice => choice };
const demoAction = "web-authenticator-demo-f47ac10b-58cc-4372-8567-0e02b2c3d479";
afterAll(() => GlobalRegistrator.unregister());
// Request flows live at /verify; the landing and authenticator tests visit their own paths.
const visit = (path: string) => window.history.replaceState(null, "", path);
beforeEach(() => visit("/verify"));
afterEach(() => { cleanup(); visit("/"); });

async function fixture(schema: number, available = false) {
  const { payload } = await signedRequest(schema);
  let records = available ? [{ credentialId: 1n, issuerSchemaId: BigInt(schema), isExpired: false, expiresAt: BigInt(Math.floor(Date.now()/1000)+3600), genesisIssuedAt: 0n } as CredentialMetadata] : [];
  const calls = { unlocked: 0, prove: 0, deliver: [] as string[], failDelivery: false, listed: 0, deleted: [] as bigint[], failDelete: false, terminated: 0 };
  const incoming: IncomingRequest = {
    proof: payload.proof_request, label: "rp_1", actionLabel: payload.action,
    validate: async () => {}, cancel: async () => {},
    deliver: async proof => { calls.deliver.push(proof); if (calls.failDelivery) throw new Error("Transport unavailable"); },
  };
  const wallet = {
    listCredentials: async () => { calls.listed++; return records; },
    deleteCredential: async (id: bigint) => { calls.deleted.push(id); if (calls.failDelete) throw new Error("private worker error"); records = records.filter(record => record.credentialId !== id); },
    terminate: () => { calls.terminated++; },
  } as unknown as WalletKit;
  const services = {
    load: async (): Promise<IncomingRequest | null> => incoming,
    open: async () => wallet,
    unlock: async (): Promise<RequestWalletSession> => { calls.unlocked++; return { ready: Promise.resolve({ wallet }), dispose: () => wallet.terminate() }; },
    prove: async () => { calls.prove++; return JSON.stringify({ id: "test-request", responses: [{}] }); },
  };
  return { services, calls, incoming, wallet };
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

test("a request link waits behind consent and continues to unlock and capture once the user chooses", async () => {
  const f = await fixture(11);
  const consent: ConsentClient = { read: async () => "unset", save: async choice => choice };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Decline" }));
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

test("public Selfie capture reuses the unlocked session without another save prompt or a proof", async () => {
  const f = await fixture(11);
  let opened = 0;
  f.services.open = async () => { opened++; throw new Error("Public capture must not open a wallet"); };
  const captureMock = spyOn(capture, "captureSelfie").mockResolvedValue({
    image: new Blob(["test"], { type: "image/jpeg" }),
    timing: { guidanceMs: 1, totalMs: 1, width: 640, height: 480 },
  });
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    // Browser lifecycle tests inspect transient animation states with a controlled clock.
    await waitFor(() => expect(f.calls.terminated).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(view.queryByRole("region", { name: "Selfie capture" }) === null).toBe(true), { timeout: 4000 });
    expect(f.calls.unlocked).toBe(1);
    expect(f.calls.terminated).toBe(1);
    expect(view.queryByRole("button", { name: "Save with passkey" })).toBeNull();
    expect(await view.findByRole("heading", { name: "Selfie captured" })).toBeTruthy();
    expect(view.queryByRole("region", { name: "Selfie capture" }) === null).toBe(true);
    expect(view.queryByRole("button", { name: /Approve|Set up|Retake|passkey|Go to authenticator/ })).toBeNull();
    expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(opened).toBe(0);
    expect(f.calls.prove).toBe(0);
    expect(f.calls.deliver).toHaveLength(0);
    expect(view.queryByRole("switch", { name: "Dev mode" })).toBeNull();
  } finally { captureMock.mockRestore(); }
});

test("the localhost demo opens the wallet and follows PoseGuard directions before reporting a capture result", async () => {
  visit(DEMO_PATH);
  const f = await fixture(11, true);
  const appId = `app_${"0".repeat(32)}` as const;
  const returnUrl = new URL(DEMO_PATH, window.location.origin).href;
  Object.assign(f.incoming, { appId, bridgeRequestId: bridgeId, returnUrl, actionLabel: demoAction });
  const query = `i=${bridgeId}&k=test`;
  const unexpectedPoll = () => { throw new Error("The local demo must not poll for a proof."); };
  const create = spyOn(demo, "startDemo").mockResolvedValue({
    bridgeId, query, returnUrl,
    config: { app_id: appId, action: demoAction, rp_context: f.incoming.proof },
    request: {
      connectorURI: new URL(`/verify?${query}`, returnUrl).href,
      requestId: bridgeId,
      pollOnce: unexpectedPoll,
      pollUntilCompletion: unexpectedPoll,
      getDebugReport: unexpectedPoll,
    },
  });
  let update!: Parameters<poseGuard.RunPoseGuard>[2];
  let finish!: (result: poseGuard.PoseGuardOutcome) => void;
  const outcome = new Promise<poseGuard.PoseGuardOutcome>(resolve => { finish = resolve; });
  const configure = spyOn(demoEnrollment, "configureDemoEnrollment").mockReturnValue(async (_video, _signal, report) => {
    update = report;
    update({ phase: "framing", title: "Look straight ahead", hint: "", progress: 0, cameraReady: true, target: null, poseStep: { index: 1, total: 4 } });
    return outcome;
  });
  const captureMock = spyOn(capture, "captureSelfie").mockRejectedValue(new Error("The demo requires PoseGuard."));
  const log = spyOn(console, "info").mockImplementation(() => {});
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    // The demo creates its request on arrival and hands over to the consent screen at /verify.
    expect(await view.findByRole("heading", { name: "Request from Web Authenticator" })).toBeTruthy();
    expect(window.location.pathname).toBe("/verify");
    expect(create).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.filter(([event]) => event === "selfie_check_beta_request")).toEqual([
      ["selfie_check_beta_request", {
        environment: "staging", action: demoAction, schemaId: 11, appId,
        rpId: f.incoming.proof.rp_id, requestId: bridgeId, expiresAt: f.incoming.proof.expires_at,
      }],
    ]);
    expect(f.calls.unlocked).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    expect(await view.findByRole("heading", { name: "Look straight ahead" })).toBeTruthy();
    expect(view.getByText("Step 1 of 4")).toBeTruthy();
    expect(view.queryByTestId("pose-target-indicator")).toBeNull();
    expect(f.calls.unlocked).toBe(1);

    act(() => {
      update({ phase: "captured", title: "Look straight ahead", hint: "", progress: 0.25,
        cameraReady: true, target: null, poseStep: { index: 1, total: 4 } });
      update({ phase: "framing", title: "Turn your head left", hint: "", progress: 0.25, cameraReady: true,
        target: { pitch: 0, yaw: 30 }, poseStep: { index: 2, total: 4 } });
    });
    // Nothing marks the moment a frame is taken.
    expect(view.queryByTestId("pose-capture-confirmation")).toBeNull();
    const filled = view.getByTestId("selfie-design-ring").querySelectorAll('[data-filled="true"]');
    expect(filled).toHaveLength(16);
    expect(filled[0].getAttribute("fill")).toBe("currentColor");
    expect(view.getByText("Turn your head left")).toBeTruthy();
    expect(view.getByText("Step 2 of 4")).toBeTruthy();
    expect(view.getByTestId("pose-target-indicator").style.maskImage).toBe("conic-gradient(from -112.5deg, #000 0deg 45deg, transparent 45deg)");
    expect(view.queryByRole("heading", { name: "PoseGuard captures accepted" })).toBeNull();

    finish("captured");
    expect(await view.findByRole("heading", { name: "PoseGuard captures accepted" })).toBeTruthy();
    expect(view.getByText(demoAction)).toBeTruthy();
    expect(view.queryByText("Use the staging demo to test signup-service.")).toBeNull();
    expect(view.queryByText("Beta", { exact: true })).toBeNull();
    expect(view.getByText("Request details")).toBeTruthy();
    expect(configure).toHaveBeenCalledTimes(1);
    expect(captureMock).not.toHaveBeenCalled();
    expect(f.calls.terminated).toBe(1);
    expect(f.calls.deliver).toHaveLength(0);
    expect(view.queryByRole("heading", { name: /verified/i })).toBeNull();
  } finally {
    create.mockRestore();
    configure.mockRestore();
    captureMock.mockRestore();
    log.mockRestore();
  }
});

test.each(["accepted", "rejected", "replayed"] as const)("hosted demo shows the %s proof outcome", async result => {
  const f = await fixture(11, result === "replayed");
  f.wallet.generateProof = async () => {
    if (result === "replayed") {
      throw Object.assign(new Error("nullifier_replay"), { name: "WalletKitError", code: "NullifierReplay" });
    }
    return "test-proof";
  };
  const appId = `app_${"0".repeat(32)}` as const;
  const returnUrl = new URL(DEMO_PATH, ENVIRONMENTS.staging.appOrigin).href;
  Object.assign(f.incoming, { appId, bridgeRequestId: bridgeId, returnUrl, actionLabel: demoAction });
  const query = `i=${bridgeId}&k=test`;
  const connector = new URL(`/verify?${query}`, returnUrl);
  const unexpectedPoll = () => { throw new Error("The verifier handles bridge polling."); };
  const create = spyOn(demo, "startDemo").mockResolvedValue({
    bridgeId, query, returnUrl,
    config: { app_id: appId, action: demoAction, rp_context: f.incoming.proof },
    request: {
      connectorURI: connector.href, requestId: bridgeId,
      pollOnce: unexpectedPoll, pollUntilCompletion: unexpectedPoll, getDebugReport: unexpectedPoll,
    },
  });
  const configure = spyOn(demoEnrollment, "configureDemoEnrollment").mockReturnValue(async () => "completed");
  const verdict = Promise.withResolvers<void>();
  const verify = spyOn(demo, "verifyDemo").mockReturnValue(verdict.promise);
  const log = spyOn(console, "info").mockImplementation(() => {});
  const browser = (window as typeof window & { happyDOM?: { setURL(url: string): void } }).happyDOM;
  if (!browser) throw new Error("Expected a detached browser fixture.");
  const originalUrl = window.location.href;
  browser.setURL(returnUrl);
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    if (result === "replayed") {
      expect(await view.findByRole("heading", { name: "Proof already created" })).toBeTruthy();
      expect(view.getByText("The authenticator detected a nullifier replay for this action.")).toBeTruthy();
      expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(configure).not.toHaveBeenCalled();
      expect(f.calls.deliver).toEqual([]);
      expect(verify).not.toHaveBeenCalled();
      // Returning ends the attempt; it must not start another request on its own.
      fireEvent.click(view.getByRole("button", { name: "Return to demo" }));
      expect(await view.findByRole("heading", { name: "Check cancelled" })).toBeTruthy();
      expect(view.getByRole("button", { name: "Create another request" })).toBeTruthy();
      expect(create).toHaveBeenCalledTimes(1);
      return;
    }
    expect(await view.findByRole("heading", { name: "Verifying proof…" })).toBeTruthy();
    expect(f.calls.deliver).toEqual(["test-proof"]);
    expect(configure).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("heading", { name: "New credential verified" })).toBeNull();
    if (result === "accepted") {
      verdict.resolve();
      expect(await view.findByRole("heading", { name: "New credential verified" })).toBeTruthy();
    } else {
      verdict.reject(new Error("The relying party rejected the proof."));
      expect((await view.findByRole("alert")).textContent).toBe("The relying party rejected the proof.");
      expect(await view.findByRole("button", { name: "Try again" })).toBeTruthy();
      expect(view.queryByRole("heading", { name: "New credential verified" })).toBeNull();
    }
  } finally {
    cleanup();
    browser.setURL(originalUrl);
    create.mockRestore();
    configure.mockRestore();
    verify.mockRestore();
    log.mockRestore();
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

for (const fails of [false, true]) {
  test(`background account preparation ${fails ? "surfaces failure" : "waits after capture without another passkey"}`, async () => {
    const f = await fixture(11);
    const ready = Promise.withResolvers<{ wallet: WalletKit } | { error: unknown }>();
    f.services.unlock = async () => {
      f.calls.unlocked++;
      return { ready: ready.promise, dispose: () => f.wallet.terminate() };
    };
    const captureMock = spyOn(capture, "captureSelfie").mockResolvedValue({
      image: new Blob(["test"], { type: "image/jpeg" }),
      timing: { guidanceMs: 1, totalMs: 1, width: 640, height: 480 },
    });
    try {
      const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
      fireEvent.click(await view.findByRole("button", { name: "Continue" }));
      await waitFor(() => expect(view.getByTestId("request-frame").getAttribute("data-stage")).toBe("preparing"));
      expect(f.calls.unlocked).toBe(1);
      expect(f.calls.terminated).toBe(0);
      expect(view.queryByRole("button", { name: "Save with passkey" })).toBeNull();
      await act(async () => { ready.resolve(fails ? { error: new WalletOpenError("Registration is unavailable.") } : { wallet: f.wallet }); });
      if (fails) {
        await view.findByRole("heading", { name: "Something went wrong" });
        expect(view.getByText("Registration is unavailable.")).toBeTruthy();
      } else {
        await waitFor(() => expect(view.queryByRole("region", { name: "Selfie capture" }) === null).toBe(true), { timeout: 4000 });
        expect(captureMock).toHaveBeenCalledTimes(1);
      }
      expect(f.calls.terminated).toBe(1);
      expect(f.calls.unlocked).toBe(1);
    } finally { captureMock.mockRestore(); }
  });
}

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
  [new Error("private worker error"), "The encrypted wallet could not initialize. Close other authenticator tabs and retry."],
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
