import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { DEMO_ACTION, DEMO_PATH } from "../config/demo";
import { actions, body, centeredLayout, errorCopy, messageBlock, primaryAction, requestFrame, screenContent, screenTitle, secondaryAction } from "./components/styles";
import { currentProtocolEnvironment } from "./lib/environment";
import { startDemo, verifyDemo, type DemoAttempt, type DemoHandoff, type DemoProofSource } from "./lib/demo";

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
      setState({ phase: "error", message: "This request expired. Create a fresh request." });
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
            <h1 className={screenTitle}>Open the demo on localhost</h1>
            <p className={body}>Use the localhost hostname so your browser can create a passkey.</p>
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
  const status = demoStatus(demo.state);

  return <section className={requestFrame} aria-label="Selfie Check demo">
    <div className={screenContent}>
      <div className={centeredLayout}>
        <div className={`${messageBlock} gap-4`}>
          <h1 className={screenTitle}>{status.title}</h1>
          <p className={body} role="status">{status.description}</p>
          {demo.state.phase === "error" && <p className={errorCopy} role="alert">{demo.state.message}</p>}
          <DemoRequestDetails attempt={demo.attempt} expanded={ready} />
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

function DemoRequestDetails({ attempt, expanded }: { attempt?: DemoHandoff; expanded: boolean }) {
  const rows = [
    ["Environment", "Staging"],
    ["Action", DEMO_ACTION],
    ["Credential", "Selfie Check (schema 11)"],
    ...(attempt ? [
      ["App ID", attempt.config.app_id],
      ["RP ID", attempt.config.rp_context.rp_id],
      ["Request ID", attempt.bridgeId],
      ["Nonce", attempt.config.rp_context.nonce],
      ["Expires", new Date(attempt.config.rp_context.expires_at * 1000).toISOString()],
    ] : []),
  ];
  return <details className="w-full rounded-2xl bg-background-secondary px-4 py-3 text-left text-[13px]" open={expanded}>
    <summary className="cursor-pointer font-medium">Request details</summary>
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
      {rows.map(([label, value]) => <div key={label} className="contents">
        <dt className="text-foreground-secondary">{label}</dt>
        <dd className="min-w-0 break-all font-mono">{value}</dd>
      </div>)}
    </dl>
  </details>;
}

function demoStatus(state: DemoState): { title: string; description: string } {
  if (state.phase === "verified") {
    return state.source === "issued"
      ? { title: "New credential verified", description: "You completed PoseGuard, saved the issued Selfie Check credential, and sent a proof the relying party verified." }
      : { title: "Saved credential verified", description: "The relying party verified a proof from the Selfie Check credential already in your wallet." };
  }
  if (state.phase === "captured") {
    return { title: "PoseGuard captures accepted", description: "The staging TEE accepted your center image and all three target images." };
  }
  if (state.phase === "verifying") return { title: "Verifying your proof", description: "Waiting for the staging relying party." };
  if (state.phase === "ready") return { title: "Selfie Check request created", description: "Review the request below, then open Web Authenticator." };
  if (state.phase === "waiting") return { title: "Check in progress", description: "Complete the request in Web Authenticator." };
  return {
    title: "Try Web Authenticator",
    description: state.phase === "starting" ? "Creating a World ID request…"
      : "Create or unlock an authenticator and complete a Selfie Check request on staging.",
  };
}

function demoError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The demo could not be completed. Try again.";
}
