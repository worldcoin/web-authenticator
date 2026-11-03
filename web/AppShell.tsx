import { Outlet, useRouterState } from "@tanstack/react-router";
import { createContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppLayout } from "./components/AppLayout";
import { ConsentScreen } from "./components/ConsentScreen";
import type { ConsentChoice, ConsentClient, ConsentState } from "./lib/consent";
import { CONSENT_KEY } from "./lib/consent";
import { analyticsService } from "./lib/analytics";

/** Hides shared chrome while the full-screen camera is open. */
export const CaptureScreenContext = createContext<(active: boolean) => void>(() => {});

/** Hides the menu while a timed sequence plays. */
export const CompletionAnimationContext = createContext<(active: boolean) => void>(() => {});
export const AnalyticsConsentContext = createContext<ConsentState | null>(null);

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
  const consentRevision = useRef(0);
  const unsavedDenial = useRef(false);

  useLayoutEffect(() => { analyticsService.setConsent(consentState); }, [consentState]);

  useEffect(() => {
    let active = true;
    // Unreadable storage shows the choice again rather than assuming one.
    const read = () => {
      const revision = ++consentRevision.current;
      void consent.read().then(state => {
        if (active && revision === consentRevision.current) {
          const effective = unsavedDenial.current ? "denied" : state;
          analyticsService.setConsent(effective); setConsentState(effective);
        }
      }, () => {
        if (active && revision === consentRevision.current) { analyticsService.setConsent("unset"); setConsentState("unset"); }
      });
    };
    const storage = (event: StorageEvent) => { if (event.key === CONSENT_KEY || event.key === null) read(); };
    const visibility = () => {
      if (!document.hidden) read();
    };
    read();
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false; void analyticsService.shutdown();
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [consent]);

  const chooseConsent = async (choice: ConsentChoice) => {
    ++consentRevision.current;
    // Revocation stops collection even when persistence fails.
    if (choice === "denied") { unsavedDenial.current = true; analyticsService.setConsent("denied"); }
    setConsentBusy(true); setConsentError(null);
    try {
      const saved = await consent.save(choice);
      unsavedDenial.current = false;
      analyticsService.setConsent(saved);
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
      <AnalyticsConsentContext value={consentState}>
        <CompletionAnimationContext value={setCompletionAnimating}><CaptureScreenContext value={setCaptureActive}><Outlet /></CaptureScreenContext></CompletionAnimationContext>
      </AnalyticsConsentContext>
    </div>
  </AppLayout>;
}
