import { Outlet, useRouterState } from "@tanstack/react-router";
import { createContext, useEffect, useState } from "react";
import { AppLayout } from "./components/AppLayout";
import { ConsentScreen } from "./components/ConsentScreen";
import type { ConsentChoice, ConsentClient, ConsentState } from "./lib/consent";
import { createSelfieCheckDiagnostics } from "./lib/selfie-check-debug-report";

/** Hides shared chrome while the full-screen camera is open. */
export const CaptureScreenContext = createContext<(active: boolean) => void>(() => {});

/** Hides the menu while a timed sequence plays. */
export const CompletionAnimationContext = createContext<(active: boolean) => void>(() => {});

export const SelfieCheckDiagnosticsContext = createContext<ReturnType<typeof createSelfieCheckDiagnostics> | null>(null);

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
  const [diagnostics] = useState(createSelfieCheckDiagnostics);

  useEffect(() => {
    let active = true;
    // Unreadable storage shows the choice again rather than assuming one.
    const applyConsent = (state: ConsentState) => {
      if (!active) return;
      diagnostics.setConsent(state);
      setConsentState(state);
    };
    void consent.read().then(applyConsent, () => applyConsent("unset"));
    return () => { active = false; };
  }, [consent, diagnostics]);

  const chooseConsent = async (choice: ConsentChoice) => {
    if (consentBusy) return;
    if (choice === "denied") diagnostics.setConsent(choice);
    setConsentBusy(true); setConsentError(null);
    try {
      const saved = await consent.save(choice);
      diagnostics.setConsent(saved);
      setConsentState(saved);
      setConsentOpen(false);
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
      <SelfieCheckDiagnosticsContext value={diagnostics}>
        <CompletionAnimationContext value={setCompletionAnimating}><CaptureScreenContext value={setCaptureActive}><Outlet /></CaptureScreenContext></CompletionAnimationContext>
      </SelfieCheckDiagnosticsContext>
    </div>
  </AppLayout>;
}
