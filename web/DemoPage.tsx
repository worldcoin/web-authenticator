import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { DEMO_PATH } from "../config/demo";
import { actions, betaLabel, body, centeredLayout, errorCopy, messageBlock, primaryAction, requestFrame, screenContent, screenTitle, secondaryAction } from "./components/styles";
import { currentProtocolEnvironment } from "./lib/environment";
import { startDemo, verifyDemo, type DemoAttempt, type DemoHandoff, type DemoProofSource } from "./lib/demo";
import { logDemoRequest } from "./lib/flow-logging";

type DemoState =
  | { phase: "idle" | "starting" | "ready" | "waiting" | "verifying" | "captured" }
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

  const stop = () => {
    active.current?.controller.abort();
    active.current = null;
  };

  const cancel = () => {
    stop();
    setAttempt(undefined);
    setState({ phase: "idle" });
  };

  const create = async () => {
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
  };

  const open = () => {
    const next = active.current?.attempt;
    if (!next) return;
    if (next.config.rp_context.expires_at * 1000 <= Date.now()) {
      stop();
      setState({ phase: "error", message: "Request expired. Create a new request." });
      return;
    }
    setState({ phase: "waiting" });
    return next.query;
  };

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
  const navigate = useNavigate();
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
  const { phase } = demo.state;
  const ready = phase === "ready";
  const waiting = phase === "waiting" || phase === "verifying";
  const starting = phase === "starting";
  const open = () => {
    const query = demo.open();
    if (query) void navigate({ to: "/verify", search: { query } });
  };
  return <section className={requestFrame} aria-label="Selfie Check beta">
    <div className={screenContent}>
      <div className={centeredLayout}>
        <div className={`${messageBlock} gap-4`}>
          <span className={betaLabel}>Beta</span>
          <h1 className={screenTitle} aria-live="polite">{demoTitle(demo.state)}</h1>
          {demo.state.phase === "error" && <p className={errorCopy} role="alert">{demo.state.message}</p>}
        </div>
      </div>
    </div>
    <div className={actions}>
      {ready && <button type="button" className={primaryAction} onClick={open}>Open authenticator</button>}
      {ready || waiting ? <button type="button" className={secondaryAction} onClick={demo.cancel}>Cancel request</button>
        : <button type="button" className={primaryAction} disabled={starting} onClick={() => void demo.create()}>
          {starting ? "Creating request…" : demo.attempt ? "Create another request" : "Create Selfie Check request"}
        </button>}
    </div>
  </section>;
}

function demoTitle(state: DemoState): string {
  if (state.phase === "verified") {
    return state.source === "issued" ? "New credential verified" : "Saved credential verified";
  }
  if (state.phase === "captured") return "PoseGuard captures accepted";
  if (state.phase === "verifying") return "Verifying proof…";
  if (state.phase === "ready") return "Selfie Check request created";
  if (state.phase === "waiting") return "Check in progress";
  return "Selfie Check";
}

function demoError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Demo failed. Try again.";
}
