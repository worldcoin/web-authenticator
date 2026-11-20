import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { actions, body, centeredLayout, errorCopy, messageBlock, primaryAction, requestFrame, screenContent, screenTitle, secondaryAction } from "./components/styles";
import { currentProtocolEnvironment } from "./lib/environment";
import { startDemo, verifyDemo, type DemoHandoff } from "./lib/demo";

type DemoState = { phase: "idle" | "starting" | "waiting" | "verified" } | { phase: "error"; message: string };

export const DemoContext = createContext<{
  state: DemoState;
  attempt: DemoHandoff | undefined;
  start: () => Promise<string | undefined>;
  cancel: () => void;
} | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState<DemoState>({ phase: "idle" });
  const [attempt, setAttempt] = useState<DemoHandoff>();

  useEffect(() => {
    const stop = () => active.current?.abort();
    window.addEventListener("pagehide", stop);
    return () => { window.removeEventListener("pagehide", stop); stop(); };
  }, []);

  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setAttempt(undefined);
    setState({ phase: "idle" });
  };

  const start = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setAttempt(undefined);
    setState({ phase: "starting" });
    try {
      const next = await startDemo(controller.signal);
      controller.signal.throwIfAborted();
      setAttempt({ config: next.config, bridgeId: next.bridgeId, returnUrl: next.returnUrl });
      setState({ phase: "waiting" });
      void verifyDemo(next, controller.signal).then(() => {
        if (!controller.signal.aborted) setState({ phase: "verified" });
      }).catch(error => {
        if (!controller.signal.aborted) setState({ phase: "error", message: demoError(error) });
      }).finally(() => {
        if (active.current === controller) {
          active.current = null;
        }
      });
      return next.query;
    } catch (error) {
      if (active.current === controller) {
        active.current = null;
        setState({ phase: "error", message: demoError(error) });
      }
    }
  };

  return <DemoContext value={{ state, attempt, start, cancel }}>{children}</DemoContext>;
}

export function DemoPage() {
  const demo = use(DemoContext);
  const navigate = useNavigate();
  if (currentProtocolEnvironment() !== "staging" || !demo) {
    return <section className={requestFrame}><div className={screenContent}><p className={body}>Page not found.</p></div></section>;
  }
  const { phase } = demo.state;
  const starting = phase === "starting";
  const waiting = phase === "waiting";
  const verified = phase === "verified";
  const begin = async () => {
    const query = await demo.start();
    if (query) await navigate({ to: "/verify", search: { query } });
  };

  return <section className={requestFrame} aria-label="Selfie Check demo">
    <div className={screenContent}>
      <div className={centeredLayout}>
        <div className={`${messageBlock} gap-4`}>
          <h1 className={screenTitle}>{verified ? "Selfie Check verified" : "Try Web Authenticator"}</h1>
          <p className={body} role="status">
            {verified ? "The demo relying party verified your Selfie Check proof."
              : starting ? "Creating a World ID request…"
                : waiting ? "Waiting for the Selfie Check result…"
                  : "Create or unlock an authenticator and complete a Selfie Check request on staging."}
          </p>
          {demo.state.phase === "error" && <p className={errorCopy} role="alert">{demo.state.message}</p>}
        </div>
      </div>
    </div>
    <div className={actions}>
      {waiting ? <button type="button" className={secondaryAction} onClick={demo.cancel}>Cancel request</button>
        : <button type="button" className={primaryAction} disabled={starting} onClick={() => void begin()}>
          {verified ? "Start another check" : "Try Selfie Check"}
        </button>}
    </div>
  </section>;
}

function demoError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The demo could not be completed. Try again.";
}
