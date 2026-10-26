import {
  ANALYTICS_BATCH_SIZE, isAnalyticsEvent,
  type AnalyticsEntryPoint, type AnalyticsEvent, type AnalyticsReason, type AnalyticsStatus, type AnalyticsStep,
} from "../../packages/contracts/src/analytics";
import type { ConsentState } from "./consent";

export function analyticsReason(error: unknown): AnalyticsReason {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "TimeoutError": return "timeout";
    case "AbortError": return "cancelled";
    case "NotAllowedError": case "SecurityError": return "permission_denied";
    case "NotFoundError": case "OverconstrainedError": return "camera_missing";
    case "NotReadableError": return "camera_busy";
    case "NotSupportedError": return "unsupported";
    case "InvalidStateError": return "invalid_state";
    case "QuotaExceededError": return "storage_full";
    case "DataError": case "SyntaxError": return "invalid_data";
    case "NetworkError": return "network_error";
    default: return "operation_error";
  }
}

type Outcome = Exclude<AnalyticsStatus, "started">;
type Finish = (status: Outcome, reason?: AnalyticsReason) => void;
type Pending = { event: AnalyticsEvent; failures: number };

/** One consented page visit; no cookies, persistent identity, replay or automatic capture. */
export class FlowAnalytics {
  private consent = false;
  private generation = 0;
  private flowId?: string;
  private sequence = 0;
  private entryPoint: AnalyticsEntryPoint = "direct";
  private attempts = new Map<AnalyticsStep, number>();
  private seen = new Set<string>();
  private pending: Pending[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private sending = false;
  private background = false;
  private exitFlushQueued = false;
  private requests = new Set<AbortController>();

  constructor(private readonly send: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)) {}

  setConsent(state: ConsentState | null, entryPoint: AnalyticsEntryPoint = this.entryPoint) {
    this.entryPoint = entryPoint;
    if (this.consent === (state === "granted")) return;
    this.consent = state === "granted";
    this.generation++;
    this.flowId = undefined;
    this.sequence = 0;
    this.pending = [];
    this.attempts.clear(); this.seen.clear();
    clearTimeout(this.timer); this.timer = undefined;
    this.requests.forEach(request => request.abort()); this.requests.clear();
    this.sending = false;
  }

  record(step: AnalyticsStep, status: AnalyticsStatus, fields: { attempt?: number; duration_ms?: number; reason?: AnalyticsReason } = {}): boolean {
    if (!this.consent || this.pending.length >= 128) return false;
    try {
      this.flowId ??= crypto.randomUUID();
      const event: AnalyticsEvent = {
        uuid: crypto.randomUUID(), flow_id: this.flowId, sequence: ++this.sequence,
        timestamp: new Date().toISOString(), entry_point: this.entryPoint,
        step, status, attempt: fields.attempt ?? 0, ...fields,
      };
      if (!isAnalyticsEvent(event)) return false;
      this.pending.push({ event, failures: 0 });
      if (this.background && !this.exitFlushQueued) {
        this.exitFlushQueued = true;
        // Include cancellation outcomes emitted asynchronously by pagehide handlers.
        queueMicrotask(() => { this.exitFlushQueued = false; void this.flush(true); });
      } else this.schedule(250);
      return true;
    } catch { return false; } // Analytics must never break camera, passkey or proof work.
  }

  once(step: AnalyticsStep, status: AnalyticsStatus, reason?: AnalyticsReason) {
    const key = `${step}:${status}`;
    if (!this.seen.has(key) && this.record(step, status, { reason })) this.seen.add(key);
  }

  begin(step: AnalyticsStep): Finish {
    const generation = this.generation;
    const attempt = (this.attempts.get(step) ?? 0) + 1;
    const started = performance.now();
    const accepted = this.record(step, "started", { attempt });
    if (accepted) this.attempts.set(step, attempt);
    let finished = false;
    return (status, reason) => {
      if (finished) return;
      finished = true;
      // Never replay pre-consent work or an old attempt after consent is revoked/regranted.
      if (!accepted || generation !== this.generation) return;
      this.record(step, status, { attempt, reason, duration_ms: Math.min(3_600_000, Math.max(0, Math.round(performance.now() - started))) });
    };
  }

  async run<T>(step: AnalyticsStep, operation: () => Promise<T>): Promise<T> {
    const finish = this.begin(step);
    try { const result = await operation(); finish("completed"); return result; }
    catch (error) {
      const reason = analyticsReason(error);
      finish(reason === "cancelled" ? "cancelled" : "failed", reason);
      throw error;
    }
  }

  private schedule(delay: number) {
    if (this.timer !== undefined || !this.consent || !this.pending.length) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }

  setBackground(background: boolean) {
    this.background = background;
    if (background) void this.flush(true);
  }

  /** keepalive may resend an in-flight batch on page exit; UUIDs and $insert_id stay stable. */
  async flush(keepalive = false): Promise<void> {
    if (!this.consent || !this.pending.length || (this.sending && !keepalive)) return;
    clearTimeout(this.timer); this.timer = undefined;
    // On exit prioritize the most recent outcomes, including proof delivery.
    const batch = keepalive ? this.pending.slice(-ANALYTICS_BATCH_SIZE) : this.pending.slice(0, ANALYTICS_BATCH_SIZE);
    const generation = this.generation;
    const controller = new AbortController();
    this.requests.add(controller);
    if (!keepalive) this.sending = true;
    let retryDelay = 250;
    try {
      const response = await this.send("/api/analytics", {
        method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch.map(item => item.event)), keepalive,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)]),
      });
      if (generation !== this.generation) return;
      if (response.status === 403) { this.setConsent("denied"); return; }
      if (!response.ok && response.status !== 400 && response.status !== 413) throw new Error("analytics_unavailable");
      this.pending = this.pending.filter(item => !batch.includes(item));
    } catch {
      if (generation !== this.generation || controller.signal.aborted) return;
      for (const item of batch) item.failures++;
      this.pending = this.pending.filter(item => item.failures < 4);
      retryDelay = Math.min(8_000, 1_000 * 2 ** (batch[0]?.failures ?? 0));
    } finally {
      this.requests.delete(controller);
      if (generation === this.generation) {
        if (!keepalive) this.sending = false;
        this.schedule(retryDelay);
      }
    }
  }
}

export const analytics = new FlowAnalytics();
