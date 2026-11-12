import { Outlet, useRouterState } from "@tanstack/react-router";
import { createContext, useEffect, useRef, useState, type RefObject } from "react";
import { AppLayout } from "./components/AppLayout";
import { ConsentScreen } from "./components/ConsentScreen";
import type { ConsentChoice, ConsentClient, ConsentState } from "./lib/consent";

/** Hides shared chrome while the full-screen camera is open. */
export const CaptureScreenContext = createContext<(active: boolean) => void>(() => {});

/** Hides the menu while a timed sequence plays. */
export const CompletionAnimationContext = createContext<(active: boolean) => void>(() => {});

/** Request routes can continue from the first consent choice's user gesture. */
export const ConsentContinuationContext = createContext<RefObject<(() => void) | null> | null>(null);

/** Chrome and cookie consent around every route. */
export function AppShell({ consent }: { consent: ConsentClient }) {
  const isAuthenticator = useRouterState({ select: state => state.location.pathname === "/" || state.location.pathname === "/authenticator" });
  const [completionAnimating, setCompletionAnimating] = useState(false);
  const [captureActive, setCaptureActive] = useState(false);
  // null until the stored choice is read; analytics stays off unless the state is "granted".
  const [consentState, setConsentState] = useState<ConsentState | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const continuation = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    // Unreadable storage shows the choice again rather than assuming one.
    consent.read().then(state => { if (active) setConsentState(state); }, () => { if (active) setConsentState("unset"); });
    return () => { active = false; };
  }, [consent]);

  const chooseConsent = async (choice: ConsentChoice) => {
    if (consentBusy) return;
    const firstChoice = consentState === "unset" && !consentOpen;
    setConsentBusy(true); setConsentError(null);
    try {
      setConsentState(await consent.save(choice));
      setConsentOpen(false);
      if (firstChoice) continuation.current?.();
    } catch {
      setConsentError("Your choice couldn’t be saved. Try again.");
    } finally {
      setConsentBusy(false);
    }
  };

  // A first visit (no recorded choice) sees the consent screen before anything else. The page
  // stays mounted but hidden behind it, so a request link keeps validating and is ready once
  // the user chooses.
  const consentScreen = consentState === "unset" || consentOpen;

  const onCookieSettings = consentState !== null && consentState !== "unset" && !consentOpen
    ? () => { setConsentError(null); setConsentOpen(true); }
    : undefined;

  return <AppLayout onCookieSettings={onCookieSettings} hideControls={completionAnimating || captureActive} tintedBackground={isAuthenticator && !consentScreen && !captureActive}>
    {consentState !== null && consentScreen && <ConsentScreen busy={consentBusy} error={consentError} onChoose={choice => void chooseConsent(choice)} />}
    <div className="contents" hidden={consentState === null || consentScreen}>
      <ConsentContinuationContext value={continuation}><CompletionAnimationContext value={setCompletionAnimating}><CaptureScreenContext value={setCaptureActive}><Outlet /></CaptureScreenContext></CompletionAnimationContext></ConsentContinuationContext>
    </div>
  </AppLayout>;
}
