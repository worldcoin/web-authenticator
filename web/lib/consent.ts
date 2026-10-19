// Analytics consent lives in an HttpOnly cookie that only the server sets; the
// page asks the server for the state and never reads or writes cookies itself.
export type ConsentState = "granted" | "denied" | "unset";
export type ConsentChoice = Exclude<ConsentState, "unset">;

export interface ConsentClient {
  read(signal?: AbortSignal): Promise<ConsentState>;
  save(choice: ConsentChoice, signal?: AbortSignal): Promise<ConsentState>;
}

const TIMEOUT_MS = 5_000;
const isState = (value: unknown): value is ConsentState => value === "granted" || value === "denied" || value === "unset";

async function request(init: RequestInit, signal?: AbortSignal): Promise<ConsentState> {
  const response = await fetch("/api/consent", {
    ...init,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Consent request failed (HTTP ${response.status}).`);
  const body = (await response.json()) as { analytics?: unknown };
  if (!isState(body.analytics)) throw new Error("Invalid consent response.");
  return body.analytics;
}

export const consentClient: ConsentClient = {
  read: signal => request({ method: "GET" }, signal),
  save: (choice, signal) => request({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analytics: choice }),
  }, signal),
};
