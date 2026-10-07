import type {
  BrowserAdmissionDecisionV1,
} from "@clean-start/browser-admission";
import {
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  AUTHENTICATOR_UI_INITIAL_EFFECTS_V1,
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  SIMULATOR_UI_BOOTSTRAP_V0,
  dispatchAuthenticatorUiActionV1,
  makeAuthenticatorUiEventV1,
  makeAuthenticatorUiSnapshotV1,
  matchesExpectedSimulatorBrowserDemoAuthenticatorReadyV0,
  matchesExpectedSimulatorBrowserSessionViewV0,
  projectSimulatorBrowserErrorToUiEventV1,
  transitionAuthenticatorUiV1,
  type AuthenticatorUiActionV1,
  type AuthenticatorUiEffectV1,
  type AuthenticatorUiEventTypeV1,
  type AuthenticatorUiSnapshotV1,
  type AuthenticatorUiTransitionV1,
  type FrameBundleV0,
  type SimulatorBrowserDemoAuthenticatorReadyV0,
  type SimulatorBrowserSessionErrorV0,
  type SimulatorBrowserSessionViewV0,
  type SimulatorUiBootstrapV0,
} from "@clean-start/contracts";
import type { BrowserAdmissionAdapterV1 } from "../adapters/browser-admission";
import type {
  BrowserCaptureAdapterV1,
  BrowserCaptureCallbacksV1,
} from "../adapters/browser-capture";
import type { AbortableSimulatorBrowserSessionPortV0 } from "../adapters/http-session";
import { makeExplicitStagingCaptureEntryV0 } from "../adapters/staging-compatibility";

export interface AuthenticatorFlowControllerOptionsV1 {
  readonly sessionPort: AbortableSimulatorBrowserSessionPortV0;
  readonly admission: BrowserAdmissionAdapterV1;
  readonly capture: BrowserCaptureAdapterV1;
  readonly initialSnapshot?: AuthenticatorUiSnapshotV1;
  readonly initialSession?: SimulatorBrowserSessionViewV0;
  readonly closeLocally?: () => void;
  readonly navigateReturned?: () => void;
  readonly onEffect?: (effect: AuthenticatorUiEffectV1) => void;
  readonly now?: () => Date;
}

type SubscriberV1 = (snapshot: AuthenticatorUiSnapshotV1) => void;

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const encoded = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${encoded}`;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function admissionEvent(decision: BrowserAdmissionDecisionV1): AuthenticatorUiEventTypeV1 {
  if (decision.outcome === "eligible_candidate") {
    return decision.browser === "chrome"
      ? "admission_chrome_candidate"
      : "admission_safari_candidate";
  }
  if (decision.outcome === "ios_update_required") return "admission_update_required";
  if (decision.outcome === "embedded_browser_handoff") return "admission_handoff_required";
  if (decision.outcome === "context_not_top_level") return "admission_framed";
  if (decision.outcome === "insecure_context") return "admission_insecure";
  if (decision.outcome === "private_or_unknown_context") {
    return decision.context === "installed_pwa" ? "admission_pwa" : "admission_private";
  }
  if (decision.outcome === "unsupported" || decision.outcome === "uv_unavailable") {
    return "admission_unsupported";
  }
  return "admission_unknown";
}

export class AuthenticatorFlowControllerV1 {
  private snapshotValue: AuthenticatorUiSnapshotV1;
  private readonly subscribers = new Set<SubscriberV1>();
  private readonly activeControllers = new Set<AbortController>();
  private readonly tasks = new Set<Promise<void>>();
  private bootstrapValue?: SimulatorUiBootstrapV0;
  private sessionValue?: SimulatorBrowserSessionViewV0;
  private demoReadyValue?: SimulatorBrowserDemoAuthenticatorReadyV0;
  private admissionValue?: BrowserAdmissionDecisionV1;
  private artifactValue?: FrameBundleV0;
  private nonceDigestValue?: string;
  private captureNonceBase64Url?: string;
  private createIdempotencyKey = randomId("create");
  private demoIdempotencyKey = randomId("demo");
  private captureIdempotencyKey = randomId("capture");
  private retryIdempotencyKey = randomId("retry");
  private retakesUsed = 0;
  private started = false;
  private readonly now: () => Date;

  constructor(private readonly options: AuthenticatorFlowControllerOptionsV1) {
    this.now = options.now ?? (() => new Date());
    this.snapshotValue = options.initialSnapshot ?? makeAuthenticatorUiSnapshotV1({
      state: "request_checking",
      visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1.request_checking,
    });
    this.sessionValue = options.initialSession;
  }

  get snapshot(): AuthenticatorUiSnapshotV1 {
    return this.snapshotValue;
  }

  subscribe(subscriber: SubscriberV1): () => void {
    this.subscribers.add(subscriber);
    try {
      subscriber(this.snapshotValue);
    } catch {
      this.subscribers.delete(subscriber);
    }
    return () => this.subscribers.delete(subscriber);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.snapshotValue.state === "request_checking") {
      this.launch(AUTHENTICATOR_UI_INITIAL_EFFECTS_V1);
    }
  }

  act(action: AuthenticatorUiActionV1): boolean {
    if (
      action === "try_again" ||
      action === "retake" ||
      action === "continue_without_guidance"
    ) this.retakesUsed += 1;
    const transition = dispatchAuthenticatorUiActionV1(this.snapshotValue, action);
    if (transition === null) return false;
    this.apply(transition);
    return true;
  }

  interrupt(event: Extract<AuthenticatorUiEventTypeV1,
    "page_hidden" | "page_unloaded" | "orientation_invalidated" | "component_unmounted" | "operation_interrupted"
  >): void {
    this.emit(event);
  }

  dispose(): void {
    this.interrupt("component_unmounted");
    this.subscribers.clear();
  }

  async waitForIdle(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }
  }

  private emit(
    event: AuthenticatorUiEventTypeV1,
    fields: Partial<{
      detailCode: Parameters<typeof makeAuthenticatorUiEventV1>[0]["detailCode"];
      authoritativeSessionState: Parameters<typeof makeAuthenticatorUiEventV1>[0]["authoritativeSessionState"];
      rpPresentationId: Parameters<typeof makeAuthenticatorUiEventV1>[0]["rpPresentationId"];
    }> = {},
  ): boolean {
    const transition = transitionAuthenticatorUiV1(
      this.snapshotValue,
      makeAuthenticatorUiEventV1({ event, ...fields }),
    );
    if (transition === null) return false;
    this.apply(transition);
    return true;
  }

  private apply(transition: AuthenticatorUiTransitionV1): void {
    this.snapshotValue = transition.snapshot;
    for (const subscriber of this.subscribers) {
      try {
        subscriber(this.snapshotValue);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
    this.launch(transition.effects);
  }

  private launch(effects: readonly AuthenticatorUiEffectV1[]): void {
    if (effects.length === 0) return;
    const task = this.runEffects(effects)
      .catch(() => {
        this.emit("fatal_error", { detailCode: "safe_internal_error" });
      })
      .finally(() => this.tasks.delete(task));
    this.tasks.add(task);
  }

  private async runEffects(effects: readonly AuthenticatorUiEffectV1[]): Promise<void> {
    for (const effect of effects) {
      this.options.onEffect?.(effect);
      await this.runEffect(effect);
    }
    if (
      this.snapshotValue.state === "flow_cancelling" &&
      this.snapshotValue.authoritativeSessionState === null &&
      !effects.includes("cancel_session")
    ) this.emit("local_cancel_complete");
  }

  private async abortable<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      const result = await operation(controller.signal);
      return controller.signal.aborted ? undefined : result;
    } catch (cause) {
      if (controller.signal.aborted) return undefined;
      throw cause;
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  private sessionFields(): { readonly sessionId: string; readonly browserHandle: string } | null {
    return this.sessionValue === undefined ? null : {
      sessionId: this.sessionValue.sessionId,
      browserHandle: this.sessionValue.browserHandle,
    };
  }

  private handleError(value: SimulatorBrowserSessionErrorV0): void {
    if (value.reasonCode === "expired") {
      this.emit("session_expired");
      return;
    }
    const projected = projectSimulatorBrowserErrorToUiEventV1(value);
    if (projected === null) {
      this.emit("fatal_error", { detailCode: "safe_internal_error" });
      return;
    }
    const transition = transitionAuthenticatorUiV1(this.snapshotValue, projected);
    if (transition !== null) this.apply(transition);
  }

  private async acceptSessionResult(
    result: SimulatorBrowserSessionViewV0 | SimulatorBrowserSessionErrorV0,
    prepareNonce = false,
  ): Promise<void> {
    if (result.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      this.handleError(result);
      return;
    }
    if (result.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) {
      this.emit("session_failed", { detailCode: "response_invalid" });
      return;
    }
    const expected = this.sessionValue === undefined
      ? { sessionId: result.sessionId, browserHandle: result.browserHandle }
      : { sessionId: this.sessionValue.sessionId, browserHandle: this.sessionValue.browserHandle };
    const validBinding = matchesExpectedSimulatorBrowserSessionViewV0(result, {
      runtimeEnvironment: "staging",
      ...expected,
      now: this.now().toISOString(),
    });
    if (
      !validBinding ||
      (this.sessionValue === undefined &&
        (result.state !== "created" || result.code !== "created"))
    ) {
      this.emit("session_failed", { detailCode: "response_invalid" });
      return;
    }
    if (result.state === "capture_ready") {
      if (
        this.captureNonceBase64Url !== undefined &&
        this.captureNonceBase64Url !== result.nonceBase64Url
      ) {
        this.captureIdempotencyKey = randomId("capture");
      }
      this.captureNonceBase64Url = result.nonceBase64Url;
    }
    this.sessionValue = result;
    if (prepareNonce || result.state === "capture_ready") {
      this.nonceDigestValue = await sha256Text(result.nonceBase64Url);
    }
    this.emit("authoritative_session", { authoritativeSessionState: result.state });
  }

  private async runEffect(effect: AuthenticatorUiEffectV1): Promise<void> {
    if (effect === "abort_active_effects") {
      for (const controller of this.activeControllers) controller.abort();
      this.artifactValue = undefined;
      this.nonceDigestValue = undefined;
      return;
    }
    if (effect === "stop_capture") {
      this.options.capture.stop();
      return;
    }
    if (effect === "clear_transient_media") {
      this.options.capture.clearTransientMedia();
      return;
    }
    if (effect === "close_locally") {
      this.options.closeLocally?.();
      return;
    }
    if (effect === "evaluate_quality" || effect === "collect_frame_metadata") {
      this.options.capture.requestMetadataCollection();
      return;
    }
    if (effect === "validate_request") {
      const result = await this.abortable((signal) => this.options.sessionPort.bootstrap(signal));
      if (result === undefined) return;
      if (result.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
        this.handleError(result);
      } else if (result.kind === SIMULATOR_UI_BOOTSTRAP_V0) {
        this.bootstrapValue = result;
        this.emit("request_accepted", { rpPresentationId: result.rpPresentationId });
      } else {
        this.emit("fatal_error", { detailCode: "safe_internal_error" });
      }
      return;
    }
    if (effect === "evaluate_admission") {
      const result = await this.abortable((signal) => this.options.admission.evaluate(signal));
      if (result === undefined) return;
      this.admissionValue = result;
      this.emit(admissionEvent(result));
      return;
    }
    if (effect === "open_external_browser") {
      try {
        await this.abortable((signal) => this.options.admission.openExternalBrowser(signal));
      } catch {
        this.emit("handoff_failed");
      }
      return;
    }
    if (effect === "create_session") {
      const result = await this.abortable((signal) =>
        this.options.sessionPort.createSession(
          { idempotencyKey: this.createIdempotencyKey },
          signal,
        ));
      if (result !== undefined) await this.acceptSessionResult(result);
      return;
    }
    if (effect === "begin_demo_authenticator") {
      const fields = this.sessionFields();
      if (fields === null) {
        this.emit("fatal_error", { detailCode: "safe_internal_error" });
        return;
      }
      const result = await this.abortable((signal) =>
        this.options.sessionPort.beginDemoAuthenticator({
          ...fields,
          idempotencyKey: this.demoIdempotencyKey,
        }, signal));
      if (result === undefined) return;
      if (result.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
        this.handleError(result);
      } else if (
        result.kind === SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0 &&
        matchesExpectedSimulatorBrowserDemoAuthenticatorReadyV0(result, {
          runtimeEnvironment: "staging",
          sessionId: fields.sessionId,
          idempotencyKey: this.demoIdempotencyKey,
          now: this.now().toISOString(),
        }) &&
        this.sessionValue !== undefined &&
        Date.parse(result.expiresAt) <= Date.parse(this.sessionValue.expiresAt)
      ) {
        this.demoReadyValue = result;
        this.emit("demo_authenticator_ready");
      } else {
        this.emit("demo_authenticator_invalid_response");
      }
      return;
    }
    if (effect === "complete_demo_authenticator") {
      const fields = this.sessionFields();
      const ready = this.demoReadyValue;
      if (fields === null || ready === undefined) {
        this.emit("demo_authenticator_invalid_response");
        return;
      }
      const result = await this.abortable((signal) =>
        this.options.sessionPort.completeDemoAuthenticator({
          ...fields,
          idempotencyKey: ready.idempotencyKey,
          completionHandle: ready.completionHandle,
        }, signal));
      if (result !== undefined) await this.acceptSessionResult(result);
      return;
    }
    if (effect === "prepare_capture") {
      const fields = this.sessionFields();
      if (fields === null) {
        this.emit("session_failed", { detailCode: "invalid_state" });
        return;
      }
      const result = await this.abortable((signal) =>
        this.options.sessionPort.prepareCapture(fields, signal));
      if (result !== undefined) await this.acceptSessionResult(result, true);
      return;
    }
    if (effect === "start_capture") {
      this.startCapture();
      return;
    }
    if (effect === "submit_capture") {
      const fields = this.sessionFields();
      const session = this.sessionValue;
      const artifact = this.artifactValue;
      if (fields === null || session === undefined || artifact === undefined) {
        this.emit("session_failed", { detailCode: "invalid_state" });
        return;
      }
      const result = await this.abortable((signal) =>
        this.options.sessionPort.submitCapture({
          ...fields,
          idempotencyKey: this.captureIdempotencyKey,
          nonceBase64Url: session.nonceBase64Url,
          frameBundle: artifact,
        }, signal));
      if (result !== undefined) {
        await this.acceptSessionResult(result);
        if (result.kind === SIMULATOR_BROWSER_SESSION_VIEW_V0) this.artifactValue = undefined;
      }
      return;
    }
    if (effect === "retry_unavailable") {
      const fields = this.sessionFields();
      if (fields === null) {
        this.emit("session_failed", { detailCode: "invalid_state" });
        return;
      }
      const result = await this.abortable((signal) =>
        this.options.sessionPort.retryUnavailable({
          ...fields,
          idempotencyKey: this.retryIdempotencyKey,
        }, signal));
      if (result !== undefined) await this.acceptSessionResult(result);
      return;
    }
    if (effect === "query_status") {
      const fields = this.sessionFields();
      if (fields === null) {
        this.emit("session_failed", { detailCode: "invalid_state" });
        return;
      }
      const result = await this.abortable((signal) =>
        this.options.sessionPort.getStatus(fields, signal));
      if (result !== undefined) await this.acceptSessionResult(result, true);
      return;
    }
    if (effect === "cancel_session") {
      const fields = this.sessionFields();
      if (fields === null) {
        this.emit("local_cancel_complete");
        return;
      }
      const result = await this.abortable((signal) =>
        this.options.sessionPort.cancel(fields, signal));
      if (result !== undefined) {
        await this.acceptSessionResult(result);
        this.sessionValue = undefined;
        this.demoReadyValue = undefined;
      }
      return;
    }
    if (effect === "return_to_rp") {
      const fields = this.sessionFields();
      if (fields === null) {
        this.emit("return_failed", { detailCode: "return_target_invalid" });
        return;
      }
      const result = await this.abortable((signal) =>
        this.options.sessionPort.returnToRp(fields, signal));
      if (result === undefined) return;
      if (result.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
        this.handleError(result);
      } else if (result.kind === SIMULATOR_BROWSER_RETURN_ACCEPTED_V0) {
        try {
          this.options.navigateReturned?.();
          this.emit("return_completed");
        } catch {
          this.emit("return_failed", { detailCode: "navigation_failed" });
        }
      } else {
        this.emit("return_failed", { detailCode: "navigation_failed" });
      }
    }
  }

  private startCapture(): void {
    const session = this.sessionValue;
    const bootstrap = this.bootstrapValue;
    const ready = this.demoReadyValue;
    const admission = this.admissionValue;
    const nonceDigest = this.nonceDigestValue;
    if (
      session === undefined ||
      bootstrap === undefined ||
      ready === undefined ||
      admission === undefined ||
      nonceDigest === undefined
    ) {
      this.emit("capture_failed", { detailCode: "prf_not_ready" });
      return;
    }
    let entry;
    try {
      entry = makeExplicitStagingCaptureEntryV0({
        admission,
        ready,
        userActivated: true,
      });
    } catch {
      this.emit("capture_failed", { detailCode: "unsupported_context" });
      return;
    }

    const callbacks: BrowserCaptureCallbacksV1 = {
      onCaptureState: (state) => {
        if (state === "acquiring") this.emit("capture_acquiring");
        else if (state === "awaiting_first_frame") this.emit("capture_preparing");
        else if (state === "preview") this.emit("capture_preview");
        else if (state === "artifact_ready") this.emit("capture_artifact_ready");
        else if (state === "cleaning_up") this.emit("cleanup_started");
      },
      onQuality: (result) => {
        const reason = result.reasonCodes[0];
        if (result.action === "ready") this.emit("quality_ready");
        else if (result.action === "adjust" && reason !== undefined) {
          this.emit("quality_adjust", { detailCode: reason });
        } else if (result.action === "retake") {
          this.emit("quality_retake", { detailCode: "image_blurry" });
        } else if (reason !== undefined) {
          this.emit("quality_unavailable", { detailCode: reason });
        }
      },
      onArtifactReady: (artifact) => { this.artifactValue = artifact; },
      onFailure: (code) => {
        if (code === "session_expired") this.emit("session_expired");
        else this.emit("capture_failed", { detailCode: code });
      },
      onComplete: () => { this.emit("cleanup_complete"); },
    };
    try {
      this.options.capture.start({
        entry,
        policy: session.capturePolicy,
        qualityPolicy: bootstrap.qualityPolicy,
        sessionId: session.sessionId,
        accountPublicMaterialDigestSha256:
          bootstrap.accountPublicMaterialDigestSha256,
        nonceDigestSha256: nonceDigest,
        retakesUsed: this.retakesUsed,
      }, callbacks);
    } catch {
      this.emit("capture_failed", { detailCode: "unknown" });
    }
  }
}
