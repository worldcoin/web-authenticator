import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AuthenticatorAppV1 } from "../App";
import { signedRequest } from "../../tests/integration/fixtures/request";
import type { IncomingRequest } from "../lib/incoming-request";
import type { WalletKit, CredentialMetadata } from "../lib/walletkit";
import { WalletRegistrationError } from "../lib/wallet-errors";
import { RequestExpiredError } from "../lib/proof-request";
import type { ConsentClient } from "../lib/consent";
import * as capture from "../lib/selfie-capture";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
// Most tests are about other flows: consent is already decided, so the consent screen never renders.
const decidedConsent: ConsentClient = { read: async () => "denied", save: async choice => choice };
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

async function renderDev(services: Awaited<ReturnType<typeof fixture>>["services"]) {
  const view = render(<AuthenticatorAppV1 services={services} consent={decidedConsent} />);
  fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
  return view;
}

test("wallet setup timeout clears progress and offers a retry that preserves the incoming request", async () => {
  const f = await fixture(1, true);
  const open = f.services.open;
  f.services.open = async () => { throw new WalletRegistrationError("Registration may still finish. Retry to check the account.", true); };
  const view = await renderDev(f.services);
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  expect(await view.findByRole("heading", { name: "Wallet setup timed out" })).toBeTruthy();
  expect(view.queryByRole("status")).toBeNull();
  expect(view.getByText("Registration may still finish. Retry to check the account.")).toBeTruthy();
  expect(view.getByRole("link", { name: "Open authenticator" }).getAttribute("href")).toBe("/");
  f.services.open = open;
  fireEvent.click(view.getByRole("button", { name: "Retry wallet setup" }));
  await waitFor(() => expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(false));
  expect(view.queryByRole("alert")).toBeNull();
  expect(f.calls.prove).toBe(0);
});

test("definitive wallet setup failure offers retry", async () => {
  const f = await fixture(1);
  f.services.open = async () => { throw new WalletRegistrationError("Registration failed. Retry registration.", false); };
  const view = await renderDev(f.services);
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  expect(await view.findByRole("heading", { name: "Wallet setup interrupted" })).toBeTruthy();
  expect((view.getByRole("button", { name: "Retry wallet setup" }) as HTMLButtonElement).disabled).toBe(false);
});
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
  };
  return { services, calls, incoming, wallet };
}
test("missing Selfie credentials say enrollment is unavailable and keep the request and proof gate", async () => {
  const f = await fixture(11); const view = await renderDev(f.services);
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  expect(await view.findByRole("heading", { name: "Set up Selfie Check" })).toBeTruthy();
  expect(view.getByText("Selfie Check enrollment is not connected yet.")).toBeTruthy();
  expect(view.container.querySelector("video")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Back to wallet" }));
  expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(true);
  expect(f.calls.prove).toBe(0);
});
test("Orb-only requests never offer Selfie enrollment", async () => {
  const f = await fixture(1); const view = await renderDev(f.services);
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  expect(await view.findByText(/eligible Orb credential/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Set up Selfie Check" })).toBeNull();
  expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(true);
});
test("either-credential requests wait for the user's choice", async () => {
  const f = await fixture(1);
  f.incoming.proof.proof_requests.push({ identifier: "selfie", issuer_schema_id: 11 });
  f.incoming.proof.constraints = { any: ["credential", "selfie"] };
  const view = await renderDev(f.services);
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  expect(await view.findByRole("button", { name: "Set up Selfie Check" })).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Set up Selfie Check" })).toBeNull();
  expect(view.container.querySelector("video")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Set up Selfie Check" }));
  expect(await view.findByRole("heading", { name: "Set up Selfie Check" })).toBeTruthy();
  expect(view.container.querySelector("video")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Back to wallet" }));
  expect(view.getByRole("button", { name: "Set up Selfie Check" })).toBeTruthy();
  expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(true);
  expect(f.calls.prove).toBe(0);
});

test("delivery retries reuse the proof and show success only after the bridge accepts it", async () => {
  const f = await fixture(11, true); f.calls.failDelivery = true;
  const view = await renderDev(f.services);
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  await waitFor(() => expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole("button", { name: "Approve and share proof" }));
  const retry = await view.findByRole("button", { name: "Retry sending proof" });
  expect(view.queryByRole("heading", { name: "Proof response sent" })).toBeNull();
  f.calls.failDelivery = false; fireEvent.click(retry);
  expect(await view.findByRole("heading", { name: "Proof response sent" })).toBeTruthy();
  expect(f.calls.prove).toBe(1); expect(f.calls.deliver).toHaveLength(2);
  expect(f.calls.deliver[0]).toBe(f.calls.deliver[1]);
});
test("unsupported presence requirements stop before passkey setup", async () => {
  const f = await fixture(11); f.incoming.unsupportedReason = "User presence is not implemented.";
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(await view.findByText("User presence is not implemented.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Create or unlock with passkey" })).toBeNull();
  expect(view.queryByRole("button", { name: "Start check" })).toBeNull();
});

for (const pending of [false, true]) {
  test(`expired delivery offers a local exit after ${pending ? "a pending upload" : "an upload failure"}`, async () => {
    const f = await fixture(11, true);
    f.incoming.proof.expires_at = Math.ceil(Date.now() / 1000) + 1;
    let deliverySignal: AbortSignal | undefined;
    let cancellations = 0;
    f.incoming.cancel = async () => { cancellations++; };
    f.incoming.deliver = async (proof, signal) => {
      f.calls.deliver.push(proof);
      deliverySignal = signal;
      if (pending) await new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      throw new Error("Transport unavailable");
    };
    const view = await renderDev(f.services);
    fireEvent.click(await view.findByRole("button", { name: "Start check" }));
    await waitFor(() => expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(view.getByRole("button", { name: "Approve and share proof" }));
    await waitFor(() => expect(f.calls.deliver).toHaveLength(1));
    expect(await view.findByRole("heading", { name: "Request expired" }, { timeout: 3000 })).toBeTruthy();
    expect(view.getByText(/Proof delivery is unconfirmed\. Check the requesting app/)).toBeTruthy();
    expect(view.queryByText(/Retry sending the same proof/)).toBeNull();
    const retry = view.getByRole("button", { name: "Retry sending proof" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(f.calls.deliver).toHaveLength(1);
    const exit = view.getByRole("link", { name: "Open authenticator" });
    expect(exit.getAttribute("href")).toBe("/");
    // Keep this DOM test on the page while exercising the exit's cleanup.
    exit.addEventListener("click", event => event.preventDefault());
    fireEvent.click(exit);
    expect(f.calls.terminated).toBe(1);
    if (pending) expect(deliverySignal?.aborted).toBe(true);
    expect(cancellations).toBe(0);
    expect(f.calls.prove).toBe(1);
    expect(view.queryByText("No proof was sent. You can return to the requesting app.")).toBeNull();
    view.unmount();
  });
}

test("developer camera preview closes when Dev mode is turned off", async () => {
  const f = await fixture(11);
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    expect(await view.findByRole("button", { name: "Start selfie check" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Open Selfie Check" })).toBeNull();
    fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
    fireEvent.click(view.getByRole("button", { name: "Open Selfie Check" }));
    expect(await view.findByText("Open this page in a browser with camera access over HTTPS or localhost.")).toBeTruthy();
    expect((view.getByRole("button", { name: "Open Selfie Check" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Back to authenticator" }));
    expect(await view.findByRole("button", { name: "Start check" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Open Selfie Check" }));
    expect(await view.findByRole("region", { name: "Selfie capture" })).toBeTruthy();
    fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    expect(view.getByRole("button", { name: "Start selfie check" })).toBeTruthy();
  } finally {
    if (original) Object.defineProperty(navigator, "mediaDevices", original);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

test("dev mode is opt-in, inspects metadata and refreshes without issuing", async () => {
  const f = await fixture(11, true);
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(view.queryByRole("complementary", { name: "Developer tools" })).toBeNull();
  fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
  expect(view.getByText("Unlock your wallet to inspect its credentials.")).toBeTruthy();
  expect(f.calls.listed).toBe(0);
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  expect(await view.findByText("Credential ID")).toBeTruthy();
  expect(view.getByText("Selfie Check", { selector: "summary" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Open Selfie Check" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Refresh vault" }));
  await waitFor(() => expect(f.calls.listed).toBe(2));
  expect(f.calls.prove).toBe(0);
  fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
  expect(view.queryByRole("complementary", { name: "Developer tools" })).toBeNull();
});

test("vault deletion requires confirmation and removes proof eligibility", async () => {
  const f = await fixture(11, true);
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  await view.findByText("Credential ID");
  fireEvent.click(view.getByText(/Selfie Check/, { selector: "summary" }));
  fireEvent.click(view.getByRole("button", { name: "Delete local credential" }));
  expect(f.calls.deleted).toEqual([]);
  fireEvent.click(view.getByRole("button", { name: "Keep credential" }));
  expect(view.queryByRole("button", { name: "Confirm deletion" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Delete local credential" }));
  fireEvent.click(view.getByRole("button", { name: "Confirm deletion" }));
  await view.findByText("No credentials stored yet.");
  expect(f.calls.deleted).toEqual([1n]);
  expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(true);
});

test("unconfirmed vault deletion locks the wallet and hides internal errors", async () => {
  const f = await fixture(11, true); f.calls.failDelete = true;
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  await view.findByText("Credential ID");
  fireEvent.click(view.getByText(/Selfie Check/, { selector: "summary" }));
  fireEvent.click(view.getByRole("button", { name: "Delete local credential" }));
  fireEvent.click(view.getByRole("button", { name: "Confirm deletion" }));
  expect(await view.findByText(/Credential deletion could not be confirmed/)).toBeTruthy();
  expect(f.calls.terminated).toBe(1);
  expect(view.queryByText("private worker error")).toBeNull();
  expect(view.getByText("Unlock your wallet to inspect its credentials.")).toBeTruthy();
});

test("a request that expires on the review screen offers a local exit and the return link", async () => {
  const f = await fixture(1, true);
  f.incoming.proof.expires_at = Math.ceil(Date.now() / 1000) + 1;
  f.incoming.returnUrl = "https://rp.example/done";
  const view = await renderDev(f.services);
  fireEvent.click(await view.findByRole("button", { name: "Start check" }));
  await view.findByRole("button", { name: "Approve and share proof" });
  expect(view.queryByRole("link", { name: "Open authenticator" })).toBeNull();
  expect(await view.findByText(/This request expired\. Start a new request/, undefined, { timeout: 3000 })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Approve and share proof" })).toBeNull();
  expect(view.getByRole("link", { name: "Open authenticator" }).getAttribute("href")).toBe("/");
  expect(view.getByRole("link", { name: "Return to requesting app" }).getAttribute("href")).toBe("https://rp.example/done");
  expect(f.calls.prove).toBe(0);
});

test("home page offers intentional authenticator entry; only dev mode can create a wallet", async () => {
  localStorage.clear();
  const f = await fixture(1); let opened = 0;
  f.services.load = async () => null;
  const open = f.services.open; f.services.open = async (...args) => { opened++; return open(...args); };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(await view.findByRole("heading", { name: "Download World ID" })).toBeTruthy();
  expect(view.getByRole("link", { name: /World App/ }).getAttribute("href")).toBe("https://world.org/world-app");
  expect(view.queryByRole("button", { name: /passkey/ })).toBeNull();
  expect(opened).toBe(0);
  expect(view.getByRole("button", { name: "Go to authenticator" })).toBeTruthy();
  fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
  expect(view.getByRole("heading", { name: "Developer tools" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Continue with passkey" }));
  expect(await view.findByRole("heading", { name: "Developer tools" })).toBeTruthy();
  expect(opened).toBe(1);
});
test("in dev mode, a browser with a saved wallet offers unlock, and locking returns to it", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  try {
    const f = await fixture(1); f.services.load = async () => null;
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
    expect(await view.findByRole("heading", { name: "Developer tools" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Continue with passkey" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Sign in with passkey" }));
    fireEvent.click(await view.findByRole("button", { name: "Lock wallet" }));
    expect(await view.findByRole("heading", { name: "Developer tools" })).toBeTruthy();
  } finally { localStorage.clear(); }
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

test("a first visit sees the consent screen before the home page, and the choice can be reopened", async () => {
  const f = await fixture(1); f.services.load = async () => null;
  const saved: string[] = [];
  let state: "granted" | "denied" | "unset" = "unset";
  const consent: ConsentClient = { read: async () => state, save: async choice => { saved.push(choice); state = choice; return choice; } };
  const view = render(<AuthenticatorAppV1 services={f.services} consent={consent} />);
  expect(await view.findByRole("heading", { name: "Help improve World ID" })).toBeTruthy();
  expect(view.getByText(/Never photos, face data, or account identifiers/)).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Download World ID" })).toBeNull();
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  expect(view.getAllByRole("switch", { name: "Dev mode" })).toHaveLength(1);
  expect(view.queryByRole("heading", { name: "Developer tools" })).toBeNull();
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  fireEvent.click(view.getByRole("button", { name: "Accept" }));
  expect(await view.findByRole("heading", { name: "Download World ID" })).toBeTruthy();
  expect(saved).toEqual(["granted"]);
  fireEvent.click(view.getByRole("button", { name: "Cookie settings" }));
  fireEvent.click(await view.findByRole("button", { name: "Decline" }));
  expect(await view.findByRole("heading", { name: "Download World ID" })).toBeTruthy();
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
    expect(await view.findByRole("heading", { name: "Selfie captured" })).toBeTruthy();
    expect(view.queryByRole("heading", { name: "Save your authenticator?" })).toBeNull();
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    expect(opened).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    expect(await view.findByRole("heading", { name: "Save your authenticator?" })).toBeTruthy();
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
    // Toggling developer mode cannot recover the completed request from memory.
    fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
    expect(view.getByText("No request loaded.")).toBeTruthy();
  } finally { captureMock.mockRestore(); }
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
      expect(await view.findByRole("heading", { name: "Selfie captured" })).toBeTruthy();
      expect(view.queryByRole("button", { name: "Save with passkey" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
      const save = await view.findByRole("button", { name: "Save with passkey" });
      expect(opened).toBe(0);
      expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
      fireEvent.click(save);
      if (fails) {
        expect(await view.findByRole("alert")).toBeTruthy();
        expect(view.getByText(/Setup didn’t finish. A passkey may already have been saved/)).toBeTruthy();
        fireEvent.click(view.getByRole("button", { name: "Not now" }));
      }
      expect(await view.findByRole("heading", { name: "Selfie captured" })).toBeTruthy();
      expect(opened).toBe(1);
      expect(f.calls.terminated).toBe(fails ? 0 : 1);
      expect(f.calls.prove).toBe(0);
      expect(view.queryByRole("button", { name: "Save with passkey" })).toBeNull();
      expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
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
  expect(view.queryByRole("button", { name: "Start selfie check" })).toBeNull();
  expect(f.calls.prove).toBe(0);
});

test("landing entry explains request-first setup without opening camera or creating a wallet", async () => {
  localStorage.clear();
  const f = await fixture(11);
  f.services.load = async () => null;
  const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  fireEvent.click(await view.findByRole("button", { name: "Go to authenticator" }));
  expect(await view.findByRole("heading", { name: "Your authenticator" })).toBeTruthy();
  expect(view.getByText(/Complete a Selfie Check from an app request/)).toBeTruthy();
  expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
  expect(view.queryByRole("button", { name: /passkey/ })).toBeNull();
  expect(f.calls.listed).toBe(0);
  view.unmount();
  const reopened = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
  expect(await reopened.findByRole("button", { name: "Go to authenticator" })).toBeTruthy();
  expect(reopened.queryByRole("region", { name: "Selfie capture" })).toBeNull();
});

test("saved access requires explicit sign-in and shows credentials without starting camera", async () => {
  localStorage.setItem("world-id-wallet-v1", JSON.stringify({ version: 1, credentialId: "ab" }));
  try {
    const f = await fixture(11);
    f.services.load = async () => null;
    let opened = 0;
    const open = f.services.open;
    f.services.open = async () => { opened++; return open(); };
    const view = render(<AuthenticatorAppV1 services={f.services} consent={decidedConsent} />);
    const button = await view.findByRole("button", { name: "Go to authenticator" });
    expect(opened).toBe(0);
    fireEvent.click(button);
    expect(await view.findByRole("heading", { name: "Your authenticator" })).toBeTruthy();
    expect(opened).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Sign in with passkey" }));
    expect(await view.findByText("0 credentials in your saved authenticator.")).toBeTruthy();
    expect(opened).toBe(1);
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Lock authenticator" }));
    expect(f.calls.terminated).toBe(1);
    expect(view.getByRole("button", { name: "Sign in with passkey" })).toBeTruthy();
  } finally { localStorage.clear(); }
});

test("developer workspace retains the vault without synthetic issuers", async () => {
  const f = await fixture(11, true); f.services.load = async () => null;
  const view = await renderDev(f.services);
  expect(view.getAllByRole("heading", { name: "Developer tools" })).toHaveLength(1);
  expect(view.queryByRole("heading", { name: "Staging issuers" })).toBeNull();
  expect(view.queryByRole("button", { name: /Issue.*credential/ })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /Continue with passkey|Sign in with passkey/ }));
  await view.findByText(/Selfie Check/, { selector: "summary" });
  expect(view.queryByRole("button", { name: /Issue.*credential/ })).toBeNull();
  expect(f.calls.listed).toBe(1);
  expect(window.location.pathname).toBe("/");
});

test("switching modes ignores a stale unlock failure while another unlock is pending", async () => {
  const f = await fixture(11); f.services.load = async () => null;
  let rejectFirst!: (error: Error) => void; let resolveSecond!: (wallet: WalletKit) => void; let opens = 0;
  f.services.open = () => ++opens === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject; }) : new Promise(resolve => { resolveSecond = resolve; });
  const view = await renderDev(f.services);
  fireEvent.click(view.getByRole("button", { name: /Continue with passkey|Sign in with passkey/ }));
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
  fireEvent.click(view.getByRole("button", { name: /Continue with passkey|Sign in with passkey/ }));
  rejectFirst(new Error("Stale unlock failed"));
  await waitFor(() => expect((view.getByRole("button", { name: "Opening wallet…" }) as HTMLButtonElement).disabled).toBe(true));
  expect(view.queryByRole("alert")).toBeNull();
  resolveSecond(f.wallet);
  await view.findByRole("button", { name: "Lock wallet" });
});

test("a stale vault refresh cannot close a new wallet after mode toggling", async () => {
  const f = await fixture(11); f.services.load = async () => null;
  let rejectRead!: (error: Error) => void;
  f.wallet.listCredentials = () => new Promise((_resolve, reject) => { rejectRead = reject; });
  const view = await renderDev(f.services);
  fireEvent.click(view.getByRole("button", { name: /Continue with passkey|Sign in with passkey/ }));
  await view.findByRole("button", { name: "Lock wallet" });
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  const next = { listCredentials: async () => [], terminate: () => { throw new Error("New wallet must remain open"); } } as unknown as WalletKit;
  f.services.open = async () => next;
  fireEvent.click(await view.findByRole("switch", { name: "Dev mode" }));
  fireEvent.click(view.getByRole("button", { name: /Continue with passkey|Sign in with passkey/ }));
  await waitFor(() => expect((view.getByRole("button", { name: "Lock wallet" }) as HTMLButtonElement).disabled).toBe(false));
  rejectRead(new Error("Old worker stopped"));
  await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  expect(view.getByRole("button", { name: "Lock wallet" })).toBeTruthy();
  next.terminate = () => {};
});
