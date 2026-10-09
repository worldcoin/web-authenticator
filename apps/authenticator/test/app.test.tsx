import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { CameraPreview } from "../src/components/CameraPreview";
import { AuthenticatorAppV1 } from "../src/App";
import { signedRequest } from "../../../tests/integration/fixtures/request";
import type { IncomingRequest } from "../src/lib/requests/incoming-request";
import type { WalletKit, CredentialMetadata } from "../src/lib/walletkit";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:4173/" }));
afterAll(() => GlobalRegistrator.unregister());
let restore: (() => void) | undefined;
afterEach(() => { cleanup(); restore?.(); });
async function fixture(schema: number, available = false) {
  const { payload } = await signedRequest(schema);
  let records = available ? [{ issuerSchemaId: BigInt(schema), isExpired: false, expiresAt: BigInt(Math.floor(Date.now()/1000)+3600), genesisIssuedAt: 0n } as CredentialMetadata] : [];
  const calls = { prove: 0, issue: 0, deliver: [] as string[], failDelivery: false };
  const incoming: IncomingRequest = {
    proof: payload.proof_request, label: "rp_1", actionLabel: payload.action,
    validate: async () => {}, cancel: async () => {},
    deliver: async proof => { calls.deliver.push(proof); if (calls.failDelivery) throw new Error("Transport unavailable"); },
  };
  const wallet = { listCredentials: async () => records, terminate: () => {} } as unknown as WalletKit;
  const services = {
    load: async () => incoming,
    open: async () => wallet,
    prove: async () => { calls.prove++; return JSON.stringify({ id: "test-request", responses: [{}] }); },
    issue: async () => { calls.issue++; records = [{ issuerSchemaId: 11n, isExpired: false, expiresAt: BigInt(Math.floor(Date.now()/1000)+3600), genesisIssuedAt: 0n } as CredentialMetadata]; return { credentialId: 1n, issuerSchemaId: 11n }; },
  };
  const mocked = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ environment: "staging", syntheticSelfieIssuance: true }));
  restore = () => mocked.mockRestore();
  return { services, calls, incoming };
}
test("Selfie-only requests lead to enrollment, then return for separate proof approval", async () => {
  const f = await fixture(11); const view = render(<AuthenticatorAppV1 services={f.services} />);
  fireEvent.click(await view.findByRole("button", { name: "Create or unlock with passkey" }));
  expect(await view.findByRole("heading", { name: "Set up Selfie Check" })).toBeTruthy();
  expect(view.getByText(/real staging credential using synthetic face data/)).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Issue staging Selfie credential" }));
  await waitFor(() => expect((view.getByRole("button", { name: "Approve and share proof" }) as HTMLButtonElement).disabled).toBe(false));
  expect(f.calls.issue).toBe(1); expect(f.calls.prove).toBe(0);
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
  expect(f.calls.issue).toBe(0);
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

test("missing camera APIs show an actionable failure without crashing the flow", async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  try {
    const view = render(<CameraPreview />);
    expect(await view.findByText("Camera unavailable. Allow camera access, then reopen the preview.")).toBeTruthy();
  } finally {
    if (original) Object.defineProperty(navigator, "mediaDevices", original);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});
