import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AuthenticatorAppV1 } from "../App";
import { signedRequest } from "../../tests/integration/fixtures/request";
import type { IncomingRequest } from "../lib/incoming-request";
import type { WalletKit, CredentialMetadata } from "../lib/walletkit";
import { WalletRegistrationError } from "../lib/wallet-errors";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => cleanup());

test("wallet setup timeout clears progress and offers a retry that preserves the incoming request", async () => {
  const f = await fixture(1, true);
  const open = f.services.open;
  f.services.open = async () => { throw new WalletRegistrationError("Registration may still finish. Retry to check the account.", true); };
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
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
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
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
    load: async () => incoming,
    open: async () => wallet,
    prove: async () => { calls.prove++; return JSON.stringify({ id: "test-request", responses: [{}] }); },
  };
  return { services, calls, incoming };
}
test("missing Selfie credentials show unavailable enrollment without an issuance action", async () => {
  const f = await fixture(11); const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
  expect(await view.findByRole("heading", { name: "Set up Selfie Check" })).toBeTruthy();
  expect(view.getByText(/Selfie Check enrollment is not available/)).toBeTruthy();
  expect(view.queryByRole("button", { name: /Issue.*credential/ })).toBeNull();
  expect(view.queryByRole("button", { name: /camera preview/i })).toBeNull();
  expect(view.container.querySelector("video")).toBeNull();
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  expect(view.queryByRole("button", { name: /camera preview/i })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Back to wallet" }));
  expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(true);
  expect(f.calls.prove).toBe(0);
});
test("Orb-only requests never offer Selfie enrollment", async () => {
  const f = await fixture(1); const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
  expect(await view.findByText(/eligible Orb credential/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Set up Selfie Check" })).toBeNull();
  expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(true);
});
test("either-credential requests wait for the user's choice", async () => {
  const f = await fixture(1);
  f.incoming.proof.proof_requests.push({ identifier: "selfie", issuer_schema_id: 11 });
  f.incoming.proof.constraints = { any: ["credential", "selfie"] };
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
  expect(await view.findByRole("button", { name: "Set up Selfie Check" })).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Set up Selfie Check" })).toBeNull();
});
test("delivery retries reuse the proof and show success only after the bridge accepts it", async () => {
  const f = await fixture(11, true); f.calls.failDelivery = true;
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
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
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  expect(await view.findByText("User presence is not implemented.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Create or unlock with passkey" })).toBeNull();
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
    const view = render(<AuthenticatorAppV1 services={f.services} />);
    fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
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

test("the camera opens only from dev mode and closes with it", async () => {
  const f = await fixture(1);
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  try {
    const view = render(<AuthenticatorAppV1 services={f.services} />);
    expect(await view.findByRole("heading", { name: "Review your request" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Open Selfie Check" })).toBeNull();
    fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
    fireEvent.click(view.getByRole("button", { name: "Open Selfie Check" }));
    expect(await view.findByText("Open this page in a browser with camera access over HTTPS or localhost.")).toBeTruthy();
    expect((view.getByRole("button", { name: "Open Selfie Check" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Back to authenticator" }));
    expect(await view.findByRole("heading", { name: "Review your request" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Open Selfie Check" }));
    expect(await view.findByRole("region", { name: "Selfie capture" })).toBeTruthy();
    fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
    expect(view.queryByRole("region", { name: "Selfie capture" })).toBeNull();
    expect(view.getByRole("heading", { name: "Review your request" })).toBeTruthy();
  } finally {
    if (original) Object.defineProperty(navigator, "mediaDevices", original);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

test("dev mode is opt-in, inspects metadata and refreshes without issuing", async () => {
  const f = await fixture(11, true);
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  expect(view.queryByRole("complementary", { name: "Developer tools" })).toBeNull();
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  expect(view.getByText("Unlock your wallet to inspect its credentials.")).toBeTruthy();
  expect(f.calls.listed).toBe(0);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
  expect(await view.findByText("Credential ID")).toBeTruthy();
  expect(view.getByText(/Schema 11. A proof can disclose/)).toBeTruthy();
  expect(view.getByText("Local only, nothing uploaded")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Refresh vault" }));
  await waitFor(() => expect(f.calls.listed).toBe(2));
  expect(f.calls.prove).toBe(0);
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  expect(view.queryByRole("complementary", { name: "Developer tools" })).toBeNull();
});

test("vault deletion requires confirmation and removes proof eligibility", async () => {
  const f = await fixture(11, true);
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
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
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(view.getByRole("switch", { name: "Dev mode" }));
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
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
  const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
  await view.findByRole("button", { name: "Approve and share proof" });
  expect(view.queryByRole("link", { name: "Open authenticator" })).toBeNull();
  expect(await view.findByText(/This request expired\. Start a new request/, undefined, { timeout: 3000 })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Approve and share proof" })).toBeNull();
  expect(view.getByRole("link", { name: "Open authenticator" }).getAttribute("href")).toBe("/");
  expect(view.getByRole("link", { name: "Return to requesting app" }).getAttribute("href")).toBe("https://rp.example/done");
  expect(f.calls.prove).toBe(0);
});
