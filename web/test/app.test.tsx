import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AuthenticatorAppV1 } from "../App";
import { signedRequest } from "../../tests/integration/fixtures/request";
import type { IncomingRequest } from "../lib/incoming-request";
import type { WalletKit, CredentialMetadata } from "../lib/walletkit";
import { RequestExpiredError } from "../lib/proof-request";
import type { ConsentClient } from "../lib/consent";
import * as capture from "../lib/selfie-capture";
import { SelfieRejectedError, type SelfieEmbeddingSummary, type SelfieEnrollmentService } from "../lib/selfie-enrollment";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
// Most tests are about other flows: consent is already decided, so the consent screen never renders.
const decidedConsent: ConsentClient = { read: async () => "denied", save: async choice => choice };
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

async function fixture(schema: number, available = false) {
  const { payload } = await signedRequest(schema);
  let records = available ? [{ credentialId: 1n, issuerSchemaId: BigInt(schema), isExpired: false, expiresAt: BigInt(Math.floor(Date.now()/1000)+3600), genesisIssuedAt: 0n } as CredentialMetadata] : [];
  const calls = { prove: 0, deliver: [] as string[], failDelivery: false, listed: 0, deleted: [] as bigint[], failDelete: false, terminated: 0 };
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
    prove: async () => { calls.prove++; return JSON.stringify({ id: "test-request", responses: [{}] }); },
    enrollment: {
      policy: async (): Promise<string | null> => null,
      extract: async (): Promise<SelfieEmbeddingSummary> => { throw new Error("Enrollment is switched off in this fixture"); },
    } as SelfieEnrollmentService,
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
  expect(window.location.search).toBe("");
  // Load is pending: the RP is unverified, so it is not shown and the check cannot start.
  await view.findByRole("heading", { name: "Complete a Selfie Check" });
  expect(view.queryByText("rp_1")).toBeNull();
  expect((view.getByRole("button", { name: "Verifying request…" }) as HTMLButtonElement).disabled).toBe(true);
  resolve(f.incoming);
  expect(await view.findByText("rp_1 is requesting a Selfie Check.")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Start selfie check" }));
  expect(await view.findByRole("region", { name: "Selfie capture" })).toBeTruthy();
  expect(opened).toBe(0);  window.history.replaceState(null, "", "/");
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
  expect(await view.findByRole("button", { name: "Start selfie check" })).toBeTruthy();
  expect(await view.findByRole("heading", { name: "This request has expired" }, { timeout: 3000 })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Start selfie check" })).toBeNull();
  expect(view.getByRole("link", { name: "Return to the app" }).getAttribute("href")).toBe("https://rp.example/done");
});

test("a first visit sees the consent screen first, and the choice can be reopened", async () => {
  const f = await fixture(1); f.services.load = async () => null;
  const saved: string[] = [];
  let state: "granted" | "denied" | "unset" = "unset";
  const consent: ConsentClient = { read: async () => state, save: async choice => { saved.push(choice); state = choice; return choice; } };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
  expect(view.getByText(/Never photos, face data, or account identifiers/)).toBeTruthy();
  expect(view.queryByRole("heading", { name: "This request can’t be verified" })).toBeNull();
  expect(view.queryByRole("switch", { name: "Dev mode" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Accept" }));
  expect(await view.findByRole("heading", { name: "This request can’t be verified" })).toBeTruthy();
  expect(saved).toEqual(["granted"]);
  fireEvent.click(view.getByRole("button", { name: "Cookie settings" }));
  fireEvent.click(await view.findByRole("button", { name: "Decline" }));
  expect(await view.findByRole("heading", { name: "This request can’t be verified" })).toBeTruthy();
  expect(saved).toEqual(["granted", "denied"]);
});

test("a request link waits behind the consent screen and opens on its intro once the user chooses", async () => {
  const f = await fixture(11);
  const consent: ConsentClient = { read: async () => "unset", save: async choice => choice };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Start selfie check" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Decline" }));
  expect(await view.findByRole("button", { name: "Start selfie check" })).toBeTruthy();
});

test("a failed consent save keeps the consent screen with an error", async () => {
  const f = await fixture(1); f.services.load = async () => null;
  const consent: ConsentClient = { read: async () => "unset", save: async () => { throw new Error("offline"); } };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  fireEvent.click(await view.findByRole("button", { name: "Accept" }));
  expect(await view.findByText("Your choice couldn’t be saved. Try again.")).toBeTruthy();
  expect(view.getByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
});

test("an unreachable consent endpoint asks again rather than assuming a choice", async () => {
  const f = await fixture(1); f.services.load = async () => null;
  const consent: ConsentClient = { read: async () => { throw new Error("offline"); }, save: async choice => choice };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
});

test("cookie settings keeps the same capture attempt mounted", async () => {
  const f = await fixture(11);
  const captureMock = spyOn(capture, "captureSelfie").mockImplementation((_video, signal, update) => {
    update({ phase: "holding", title: "Hold still", hint: "", progress: 0.5, cameraReady: true });
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Start selfie check" }));
    const preview = await view.findByRole("region", { name: "Selfie capture" });
    await view.findByRole("heading", { name: "Hold still" });
    const signal = captureMock.mock.calls[0]![1];
    fireEvent.click(view.getByRole("button", { name: "Cookie settings" }));
    expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    expect(signal.aborted).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Decline" }));
    expect(await view.findByRole("region", { name: "Selfie capture" })).toBe(preview);
    expect(view.getByRole("heading", { name: "Hold still" })).toBeTruthy();
    expect(captureMock).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(signal.aborted).toBe(true);
  } finally { captureMock.mockRestore(); }
});

test("cookie settings preserves pending passkey saving and its completed request", async () => {
  const f = await fixture(11);
  f.incoming.returnUrl = "https://rp.example/done";
  window.history.replaceState(null, "", "/verify?i=550e8400-e29b-41d4-a716-446655440000&k=a2V5");
  let saveSignal!: AbortSignal;
  let finishSave!: (wallet: WalletKit) => void;
  const services = { ...f.services, open: (signal: AbortSignal) => {
    saveSignal = signal;
    return new Promise<WalletKit>(resolve => { finishSave = resolve; });
  } };
  const captureMock = spyOn(capture, "captureSelfie").mockResolvedValue({
    image: new Blob(["test"], { type: "image/jpeg" }),
    timing: { guidanceMs: 1, totalMs: 1, width: 640, height: 480 },
  });
  try {
    const view = render(<AuthenticatorAppV1 services={services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Start selfie check" }));
    fireEvent.click(await view.findByRole("button", { name: "Save with passkey" }, { timeout: 4000 }));
    fireEvent.click(view.getByRole("button", { name: "Cookie settings" }));
    expect(saveSignal.aborted).toBe(false);
    finishSave(f.wallet);
    fireEvent.click(await view.findByRole("button", { name: "Accept" }));
    expect(await view.findByRole("heading", { name: "Authenticator saved" })).toBeTruthy();
    expect(f.calls.terminated).toBe(1);
    fireEvent.click(view.getByRole("button", { name: "Cookie settings" }));
    fireEvent.click(await view.findByRole("button", { name: "Decline" }));
    expect(await view.findByRole("heading", { name: "Authenticator saved" })).toBeTruthy();
    expect(view.getByRole("link", { name: "Return to the app" }).getAttribute("href")).toBe("https://rp.example/done");
    expect(view.queryByRole("heading", { name: "This request can’t be verified" })).toBeNull();
  } finally { captureMock.mockRestore(); }
});

test("cookie settings preserves cancellation delivery and its failure message", async () => {
  const f = await fixture(11);
  window.history.replaceState(null, "", "/verify?i=550e8400-e29b-41d4-a716-446655440000&k=a2V5");
  let cancelSignal!: AbortSignal;
  let failCancel!: (error: Error) => void;
  f.incoming.cancel = signal => {
    cancelSignal = signal;
    return new Promise((_resolve, reject) => { failCancel = reject; });
  };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  fireEvent.click(await view.findByRole("button", { name: "Cancel request" }));
  expect(await view.findByRole("heading", { name: "Check cancelled" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Cookie settings" }));
  expect(cancelSignal.aborted).toBe(false);
  failCancel(new Error("offline"));
  fireEvent.click(await view.findByRole("button", { name: "Decline" }));
  expect(await view.findByRole("heading", { name: "Check cancelled" })).toBeTruthy();
  expect(await view.findByText(/requesting app could not be notified/)).toBeTruthy();
});

test("public Selfie capture finishes ephemerally without opening a wallet or sending a proof", async () => {
  const f = await fixture(11);
  let opened = 0;
  f.services.open = async () => { opened++; throw new Error("Public capture must not open a wallet"); };
  const captureMock = spyOn(capture, "captureSelfie").mockResolvedValue({
    image: new Blob(["test"], { type: "image/jpeg" }),
    timing: { guidanceMs: 1, totalMs: 1, width: 640, height: 480 },
  });
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Start selfie check" }));
    // Browser lifecycle tests inspect transient animation states with a controlled clock.
    expect(await view.findByRole("heading", { name: "Save your authenticator?" }, { timeout: 4000 })).toBeTruthy();
    expect(opened).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Not now" }));
    expect(await view.findByRole("heading", { name: "Selfie captured" })).toBeTruthy();
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    expect(view.queryByRole("button", { name: /Approve|Set up|Retake|passkey|Go to authenticator/ })).toBeNull();
    expect(view.queryByRole("link", { name: "Open authenticator" })).toBeNull();
    expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(opened).toBe(0);
    expect(f.calls.prove).toBe(0);
    expect(f.calls.deliver).toHaveLength(0);
    expect(view.queryByRole("switch", { name: "Dev mode" })).toBeNull();
  } finally { captureMock.mockRestore(); }
});

const POLICY = JSON.stringify({ endpoint: "wss://enclave.test/v1/embeddings", releases: [] });
const SUMMARY: SelfieEmbeddingSummary = { embeddingType: "ghostfacenet_flipped_mean", embeddingVersion: "2.0.0", embeddingInferenceBackend: "face-engine", encodedLength: 2732 };

test("with enrollment on, completion waits for the enclave to accept the captured image", async () => {
  const f = await fixture(11);
  const submitted: { policy: string; size: number }[] = [];
  let accept!: () => void;
  f.services.enrollment = {
    policy: async () => POLICY,
    extract: async (policy, image) => {
      submitted.push({ policy, size: image.size });
      await new Promise<void>(resolve => { accept = resolve; });
      return SUMMARY;
    },
  };
  const captureMock = spyOn(capture, "captureSelfie").mockResolvedValue({
    image: new Blob(["test"], { type: "image/jpeg" }),
    timing: { guidanceMs: 1, totalMs: 1, width: 640, height: 480 },
  });
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("button", { name: "Start selfie check" }));
    expect(await view.findByRole("heading", { name: "Checking your selfie" })).toBeTruthy();
    expect(view.container.querySelector(".request-processing")?.textContent).toBe("Checking your selfie");
    expect(view.queryByLabelText("Your camera preview")).toBeNull();
    expect(view.container.querySelector(".selfie-footer")).toBeNull();
    expect(submitted).toEqual([{ policy: POLICY, size: 4 }]);
    expect(view.queryByRole("heading", { name: "Save your authenticator?" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Cookie settings" }));
    await view.findByRole("heading", { name: "Help improve World ID" });
    fireEvent.click(view.getByRole("button", { name: "Decline" }));
    await view.findByRole("heading", { name: "Checking your selfie" });
    expect(submitted).toHaveLength(1);
    accept();
    expect(await view.findByRole("heading", { name: "Save your authenticator?" }, { timeout: 4000 })).toBeTruthy();
    expect(f.calls.prove).toBe(0);
    expect(f.calls.deliver).toHaveLength(0);
  } finally { captureMock.mockRestore(); }
});

for (const [name, error, title] of [
  ["an image rejection", new SelfieRejectedError("quality_rejected"), "Let's try a clearer photo"],
  ["a transport failure", new Error("wss://enclave.test refused: internal detail"), "We couldn't check your selfie"],
  ["a timeout", new DOMException("signal timed out", "TimeoutError"), "That took too long"],
] as const) {
  test(`${name} from the enclave never completes the check and offers a retry`, async () => {
    const f = await fixture(11);
    let attempts = 0;
    f.services.enrollment = { policy: async () => POLICY, extract: async () => { attempts++; throw error; } };
    const captureMock = spyOn(capture, "captureSelfie").mockResolvedValue({
      image: new Blob(["test"], { type: "image/jpeg" }),
      timing: { guidanceMs: 1, totalMs: 1, width: 640, height: 480 },
    });
    try {
      const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
      fireEvent.click(await view.findByRole("button", { name: "Start selfie check" }));
      expect(await view.findByRole("heading", { name: title })).toBeTruthy();
      expect(view.queryByText(/internal detail/)).toBeNull();
      expect(view.queryByRole("heading", { name: "Save your authenticator?" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Try again" }));
      expect(await view.findByRole("heading", { name: title })).toBeTruthy();
      expect(attempts).toBe(2);
    } finally { captureMock.mockRestore(); }
  });
}

test("an unreachable enrollment policy stops on the intro instead of capturing locally", async () => {
  const f = await fixture(11);
  f.services.enrollment = { policy: async () => { throw new Error("502"); }, extract: async () => SUMMARY };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(await view.findByText(/Selfie Check is unavailable right now/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Start selfie check" })).toBeNull();
  expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
});

test("public non-Selfie requests stop before capture or wallet access", async () => {
  const f = await fixture(1);
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(await view.findByRole("heading", { name: "This request isn’t supported here" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Start selfie check" })).toBeNull();
  expect(view.queryByRole("button", { name: /passkey|Approve/ })).toBeNull();
  expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
  expect(f.calls.listed).toBe(0);
});

for (const fails of [false, true]) {
  test(`optional passkey saving ${fails ? "reports failure and allows declining" : "closes the saved wallet and finishes"}`, async () => {
    const f = await fixture(11);
    let opened = 0;
    const open = f.services.open;
    f.services.open = async () => { opened++; if (fails) throw new Error("passkey unavailable"); return open(); };
    const captureMock = spyOn(capture, "captureSelfie").mockResolvedValue({
      image: new Blob(["test"], { type: "image/jpeg" }),
      timing: { guidanceMs: 1, totalMs: 1, width: 640, height: 480 },
    });
    try {
      const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
      fireEvent.click(await view.findByRole("button", { name: "Start selfie check" }));
      const save = await view.findByRole("button", { name: "Save with passkey" }, { timeout: 4000 });
      expect(opened).toBe(0);
      expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
      fireEvent.click(save);
      if (fails) {
        expect(await view.findByRole("alert")).toBeTruthy();
        expect(view.getByText(/Setup didn’t finish. A passkey may already have been saved/)).toBeTruthy();
        fireEvent.click(view.getByRole("button", { name: "Not now" }));
      }
      expect(await view.findByRole("heading", { name: fails ? "Selfie captured" : "Authenticator saved" })).toBeTruthy();
      expect(opened).toBe(1);
      expect(f.calls.terminated).toBe(fails ? 0 : 1);
      expect(f.calls.prove).toBe(0);
      expect(view.queryByRole("button", { name: "Save with passkey" })).toBeNull();
      expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
      if (fails) {
        expect(view.queryByRole("button", { name: "Go to authenticator" })).toBeNull();
      } else {
        localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
        fireEvent.click(view.getByRole("button", { name: "Go to authenticator" }));
        expect(await view.findByRole("heading", { name: "Your authenticator" })).toBeTruthy();
        expect(view.getByRole("button", { name: "Sign in with passkey" })).toBeTruthy();
        expect(opened).toBe(1);
        expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
        // Saved access requires an explicit sign-in and never restarts the camera.
        fireEvent.click(view.getByRole("button", { name: "Sign in with passkey" }));
        expect(await view.findByText("0 credentials in your saved authenticator.")).toBeTruthy();
        expect(opened).toBe(2);
        fireEvent.click(view.getByRole("button", { name: "Lock authenticator" }));
        expect(f.calls.terminated).toBe(2);
        // With no landing page, Back returns to the completed request.
        fireEvent.click(view.getByRole("button", { name: "Back" }));
        expect(await view.findByRole("heading", { name: "Authenticator saved" })).toBeTruthy();
        expect(view.queryByRole("button", { name: "Save with passkey" })).toBeNull();
        expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
      }
    } finally { captureMock.mockRestore(); localStorage.clear(); }
  });
}

test("public cancellation closes the request even when the bridge is unavailable", async () => {
  const f = await fixture(11);
  f.incoming.cancel = async () => { throw new Error("offline"); };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  fireEvent.click(await view.findByRole("button", { name: "Cancel request" }));
  expect(await view.findByRole("heading", { name: "Check cancelled" })).toBeTruthy();
  expect(await view.findByText(/requesting app could not be notified/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Start selfie check" })).toBeNull();
  expect(f.calls.prove).toBe(0);
});

test("/recover opens saved access only on an explicit sign-in, and Back returns to it", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  window.history.replaceState(null, "", "/recover");
  try {
    const f = await fixture(11);
    f.services.load = async () => null;
    let opened = 0;
    const open = f.services.open;
    f.services.open = async () => { opened++; return open(); };
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    expect(await view.findByRole("heading", { name: "Retrieve your World ID credentials" })).toBeTruthy();
    expect(view.queryByRole("button", { name: /passkey|Start selfie check/ })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Go to authenticator" }));
    expect(await view.findByRole("heading", { name: "Your authenticator" })).toBeTruthy();
    expect(opened).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Sign in with passkey" }));
    expect(await view.findByText("0 credentials in your saved authenticator.")).toBeTruthy();
    expect(opened).toBe(1);
    fireEvent.click(view.getByRole("button", { name: "Lock authenticator" }));
    expect(f.calls.terminated).toBe(1);
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect(await view.findByRole("heading", { name: "Retrieve your World ID credentials" })).toBeTruthy();
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
  } finally { localStorage.clear(); }
});

test("a visit without a request link has no landing page or authenticator entry", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  try {
    const f = await fixture(11);
    f.services.load = async () => null;
    let opened = 0;
    f.services.open = async () => { opened++; throw new Error("must not open"); };
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    expect(await view.findByRole("heading", { name: "This request can’t be verified" })).toBeTruthy();
    expect(view.queryByRole("heading", { name: "Download World ID" })).toBeNull();
    expect(view.queryByRole("button", { name: /Go to authenticator|passkey|Start selfie check/ })).toBeNull();
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    expect(opened).toBe(0);
    expect(f.calls.listed).toBe(0);
  } finally { localStorage.clear(); }
});
