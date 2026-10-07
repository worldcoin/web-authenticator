import {
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  isSimulatorBrowserReturnAcceptedV0,
  isSimulatorBrowserSessionErrorV0,
  isSimulatorBrowserSessionViewV0,
  isSimulatorUiBootstrapV0,
  matchesExpectedSimulatorBrowserDemoAuthenticatorReadyV0,
  matchesExpectedSimulatorBrowserSessionViewV0,
  type BrowserIdempotentSessionFieldsV0,
  type BrowserSessionFieldsV0,
  type CompleteDemoAuthenticatorV0,
  type CreateSimulatorBrowserSessionV0,
  type SimulatorBrowserBootstrapResultV0,
  type SimulatorBrowserDemoAuthenticatorResultV0,
  type SimulatorBrowserReturnResultV0,
  type SimulatorBrowserSessionOperationV0,
  type SimulatorBrowserSessionPortV0,
  type SimulatorBrowserSessionResultV0,
  type SubmitSimulatorCaptureV0,
} from "@clean-start/contracts";

type FetchV0 = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AbortableSimulatorBrowserSessionPortV0
  extends SimulatorBrowserSessionPortV0 {
  bootstrap(signal?: AbortSignal): Promise<SimulatorBrowserBootstrapResultV0>;
  createSession(input: CreateSimulatorBrowserSessionV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0>;
  beginDemoAuthenticator(input: BrowserIdempotentSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserDemoAuthenticatorResultV0>;
  completeDemoAuthenticator(input: CompleteDemoAuthenticatorV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0>;
  prepareCapture(input: BrowserSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0>;
  submitCapture(input: SubmitSimulatorCaptureV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0>;
  retryUnavailable(input: BrowserIdempotentSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0>;
  getStatus(input: BrowserSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0>;
  cancel(input: BrowserSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0>;
  returnToRp(input: BrowserSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserReturnResultV0>;
}

function stableError(operation: SimulatorBrowserSessionOperationV0, reasonCode: "network_unavailable" | "response_invalid") {
  return Object.freeze({
    kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
    version: SIMULATOR_BROWSER_SESSION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    operation,
    reasonCode,
  });
}

export class HttpSimulatorBrowserSessionClientV0
implements AbortableSimulatorBrowserSessionPortV0 {
  readonly #baseOrigin: string;

  constructor(
    private readonly fetcher: FetchV0 = globalThis.fetch.bind(globalThis),
    baseOrigin = globalThis.location?.origin ?? "http://127.0.0.1:4173",
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#baseOrigin = baseOrigin;
  }

  bootstrap(signal?: AbortSignal): Promise<SimulatorBrowserBootstrapResultV0> {
    return this.request("bootstrap", "/api/v0/bootstrap", {}, isSimulatorUiBootstrapV0, signal);
  }

  createSession(input: CreateSimulatorBrowserSessionV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0> {
    return this.request(
      "create_session",
      "/api/v0/session/create",
      input,
      (value) => isSimulatorBrowserSessionViewV0(value) &&
        value.state === "created" &&
        value.code === "created" &&
        this.matchesSession(value, {
          sessionId: value.sessionId,
          browserHandle: value.browserHandle,
        }),
      signal,
    );
  }

  beginDemoAuthenticator(input: BrowserIdempotentSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserDemoAuthenticatorResultV0> {
    return this.request(
      "begin_demo_authenticator",
      "/api/v0/session/demo/begin",
      input,
      (value) => matchesExpectedSimulatorBrowserDemoAuthenticatorReadyV0(value, {
        runtimeEnvironment: "staging",
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        now: this.now().toISOString(),
      }),
      signal,
    );
  }

  completeDemoAuthenticator(input: CompleteDemoAuthenticatorV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0> {
    return this.sessionRequest("complete_demo_authenticator", "/api/v0/session/demo/complete", input, input, signal);
  }

  prepareCapture(input: BrowserSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0> {
    return this.sessionRequest("prepare_capture", "/api/v0/session/capture/prepare", input, input, signal);
  }

  submitCapture(input: SubmitSimulatorCaptureV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0> {
    return this.sessionRequest("submit_capture", "/api/v0/session/capture/submit", input, input, signal);
  }

  retryUnavailable(input: BrowserIdempotentSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0> {
    return this.sessionRequest("retry_unavailable", "/api/v0/session/retry", input, input, signal);
  }

  getStatus(input: BrowserSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0> {
    return this.sessionRequest("get_status", "/api/v0/session/status", input, input, signal);
  }

  cancel(input: BrowserSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserSessionResultV0> {
    return this.sessionRequest("cancel", "/api/v0/session/cancel", input, input, signal);
  }

  returnToRp(input: BrowserSessionFieldsV0, signal?: AbortSignal): Promise<SimulatorBrowserReturnResultV0> {
    return this.request(
      "return_to_rp",
      "/api/v0/session/return",
      input,
      isSimulatorBrowserReturnAcceptedV0,
      signal,
    );
  }

  private sessionRequest(
    operation: SimulatorBrowserSessionOperationV0,
    path: string,
    body: unknown,
    expected: BrowserSessionFieldsV0,
    signal?: AbortSignal,
  ): Promise<SimulatorBrowserSessionResultV0> {
    return this.request(
      operation,
      path,
      body,
      (value) => this.matchesSession(value, expected),
      signal,
    );
  }

  private matchesSession(value: unknown, expected: BrowserSessionFieldsV0): boolean {
    return matchesExpectedSimulatorBrowserSessionViewV0(value, {
      runtimeEnvironment: "staging",
      sessionId: expected.sessionId,
      browserHandle: expected.browserHandle,
      now: this.now().toISOString(),
    });
  }

  private async request<T>(
    operation: SimulatorBrowserSessionOperationV0,
    path: string,
    body: unknown,
    accepts: (value: unknown) => boolean,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      const response = await this.fetcher(new URL(path, this.#baseOrigin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal,
      });
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return stableError(operation, "response_invalid") as T;
      }
      const value: unknown = await response.json();
      const accepted = isSimulatorBrowserSessionErrorV0(value)
        ? value.operation === operation
        : accepts(value);
      return (accepted ? value : stableError(operation, "response_invalid")) as T;
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return stableError(operation, "network_unavailable") as T;
    }
  }
}
