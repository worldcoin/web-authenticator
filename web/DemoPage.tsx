import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useCallback, useEffect, useRef, useState, type ContextType, type ReactNode } from "react";
import { DEMO_PATH } from "../config/demo";
import { RequestIntro } from "./components/RequestIntro";
import { actions, body, centeredLayout, consentFrame, errorCopy, messageBlock, primaryAction, requestFrame, screenContent, screenTitle, secondaryAction } from "./components/styles";
import { currentProtocolEnvironment } from "./lib/environment";
import { logDemoRequest, startDemo, verifyDemo, type DemoAttempt, type DemoHandoff, type DemoProofSource } from "./lib/demo";

type DemoState =
  | { phase: "idle" | "starting" | "ready" | "waiting" | "verifying" | "captured" | "cancelled" }
  | { phase: "verified"; source: DemoProofSource }
  | { phase: "error"; message: string };

type ActiveDemoAttempt = {
  controller: AbortController;
  attempt?: DemoAttempt;
  verifying?: boolean;
};

export const DemoContext = createContext<{
  state: DemoState;
  attempt: DemoHandoff | undefined;
  create: () => Promise<void>;
  open: () => string | undefined;
  complete: (source: DemoProofSource) => void;
  captureComplete: () => void;
  cancel: () => void;
} | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const active = useRef<ActiveDemoAttempt | null>(null);
  const [state, setState] = useState<DemoState>({ phase: "idle" });
  const [attempt, setAttempt] = useState<DemoHandoff>();

  useEffect(() => {
    const stop = () => active.current?.controller.abort();
    window.addEventListener("pagehide", stop);
    return () => { window.removeEventListener("pagehide", stop); stop(); };
  }, []);

  const stop = useCallback(() => {
    active.current?.controller.abort();
    active.current = null;
  }, []);

  const cancel = () => {
    stop();
    setAttempt(undefined);
    // Not "idle": only the first visit creates a request without a tap.
    setState({ phase: "cancelled" });
  };

  const create = useCallback(async () => {
    if (active.current) return;
    const current: ActiveDemoAttempt = { controller: new AbortController() };
    const { signal } = current.controller;
    active.current = current;
    setAttempt(undefined);
    setState({ phase: "starting" });
    try {
      const next = await startDemo(signal);
      signal.throwIfAborted();
      logDemoRequest(next.config, next.bridgeId);
      current.attempt = next;
      setAttempt({ config: next.config, bridgeId: next.bridgeId, returnUrl: next.returnUrl });
      setState({ phase: "ready" });
    } catch (error) {
      if (active.current === current) {
        active.current = null;
        setState({ phase: "error", message: demoError(error) });
      }
    }
  }, []);

  const open = useCallback(() => {
    const next = active.current?.attempt;
    if (!next) return;
    if (next.config.rp_context.expires_at * 1000 <= Date.now()) {
      stop();
      setState({ phase: "error", message: "Request expired. Create a new request." });
      return;
    }
    setState({ phase: "waiting" });
    return next.query;
  }, [stop]);

  const complete = (source: DemoProofSource) => {
    const current = active.current;
    if (!current?.attempt || current.verifying) return;
    current.verifying = true;
    const { signal } = current.controller;
    setState({ phase: "verifying" });
    void verifyDemo(current.attempt, signal).then(() => {
      if (!signal.aborted) setState({ phase: "verified", source });
    }).catch(error => {
      if (!signal.aborted) setState({ phase: "error", message: demoError(error) });
    }).finally(() => {
      if (active.current === current) active.current = null;
    });
  };

  const captureComplete = () => {
    stop();
    setState({ phase: "captured" });
  };

  return <DemoContext value={{ state, attempt, create, open, complete, captureComplete, cancel }}>{children}</DemoContext>;
}

export function DemoPage() {
  const demo = use(DemoContext);
  if (currentProtocolEnvironment() !== "staging" || !demo) {
    return <section className={requestFrame}><div className={screenContent}><p className={body}>Page not found.</p></div></section>;
  }
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "[::1]") {
    const localhost = new URL(DEMO_PATH, window.location.origin);
    localhost.hostname = "localhost";
    return <section className={requestFrame}>
      <div className={screenContent}>
        <div className={centeredLayout}>
          <div className={messageBlock}>
            <h1 className={screenTitle}>Use localhost for passkeys</h1>
          </div>
        </div>
      </div>
      <div className={actions}><a className={primaryAction} href={localhost.href}>Open localhost demo</a></div>
    </section>;
  }
  return <DemoStatus demo={demo} />;
}

/**
 * Visitors arrive knowing they are about to do a Selfie Check, so the demo creates the request
 * straight away and hands over to /verify, whose consent screen holds the tap that opens the passkey.
 */
function DemoStatus({ demo }: { demo: NonNullable<ContextType<typeof DemoContext>> }) {
  const navigate = useNavigate();
  const { phase } = demo.state;
  const { create, open } = demo;

  useEffect(() => {
    if (phase === "idle") void create();
    if (phase !== "ready") return;
    const query = open();
    // Replace /demo so Back leaves the demo instead of creating another request.
    if (query) void navigate({ to: "/verify", search: { query }, replace: true });
  }, [phase, create, open, navigate]);

  if (phase === "idle" || phase === "starting" || phase === "ready") {
    return <section className={consentFrame} aria-label="Selfie Check demo">
      <RequestIntro state="verifying" onStart={() => {}} onCancel={() => {}} />
    </section>;
  }
  const waiting = phase === "waiting" || phase === "verifying";
  return <section className={requestFrame} aria-label="Selfie Check demo">
    <div className={screenContent}>
      <div className={centeredLayout}>
        <div className={`${messageBlock} gap-4`}>
          <h1 className={screenTitle} aria-live="polite">{demoTitle(demo.state)}</h1>
          {demo.state.phase === "error" && <p className={errorCopy} role="alert">{demo.state.message}</p>}
          <DemoRequestDetails attempt={demo.attempt} />
        </div>
      </div>
    </div>
    <div className={actions}>
      {waiting ? <button type="button" className={secondaryAction} onClick={demo.cancel}>Cancel request</button>
        : <button type="button" className={primaryAction} onClick={() => void create()}>
          {phase === "error" ? "Try again" : "Create another request"}
        </button>}
    </div>
  </section>;
}

function DemoRequestDetails({ attempt }: { attempt?: DemoHandoff }) {
  const rows = [
    ["Environment", "Staging"],
    ["Credential", "Selfie Check (schema 11)"],
    ...(attempt ? [
      ["Action", attempt.config.action],
      ["App ID", attempt.config.app_id],
      ["RP ID", attempt.config.rp_context.rp_id],
      ["Request ID", attempt.bridgeId],
      ["Nonce", attempt.config.rp_context.nonce],
      ["Expires", new Date(attempt.config.rp_context.expires_at * 1000).toISOString()],
    ] : []),
  ];
  return <details className="w-full rounded-2xl bg-background-secondary px-4 py-3 text-left text-[13px]">
    <summary className="cursor-pointer font-medium">Request details</summary>
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
      {rows.map(([label, value]) => <div key={label} className="contents">
        <dt className="text-foreground-secondary">{label}</dt>
        <dd className="min-w-0 break-all font-mono">{value}</dd>
      </div>)}
    </dl>
  </details>;
}

function demoTitle(state: DemoState): string {
  if (state.phase === "verified") {
    return state.source === "issued" ? "New credential verified" : "Saved credential verified";
  }
  if (state.phase === "captured") return "PoseGuard captures accepted";
  if (state.phase === "cancelled") return "Check cancelled";
  if (state.phase === "verifying") return "Verifying proof…";
  if (state.phase === "waiting") return "Check in progress";
  return "Selfie Check";
}

function demoError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Demo failed. Try again.";
}
