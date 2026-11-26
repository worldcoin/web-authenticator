import { Outlet } from "@tanstack/react-router";
import { createContext, useEffect, useState } from "react";
import { AppLayout } from "./components/AppLayout";
import { ConsentScreen } from "./components/ConsentScreen";
import type { ConsentChoice, ConsentClient, ConsentState } from "./lib/consent";

/** Hides shared chrome while the full-screen camera is open. */
export const CaptureScreenContext = createContext<(active: boolean) => void>(() => {});

/** The request flow can reserve the full card for proof progress and completion. */
export const RequestControlsContext = createContext<(hidden: boolean) => void>(() => {});

/** Chrome and cookie consent around every route. */
export function AppShell({ consent }: { consent: ConsentClient }) {
  const [requestControlsHidden, setRequestControlsHidden] = useState(false);
  const [captureActive, setCaptureActive] = useState(false);
  // null until the stored choice is read; analytics stays off unless the state is "granted".
  const [consentState, setConsentState] = useState<ConsentState | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Unreadable storage shows the choice again rather than assuming one.
    consent.read().then(state => { if (active) setConsentState(state); }, () => { if (active) setConsentState("unset"); });
    return () => { active = false; };
  }, [consent]);

  const chooseConsent = async (choice: ConsentChoice) => {
    if (consentBusy) return;
    setConsentBusy(true); setConsentError(null);
    try {
      setConsentState(await consent.save(choice));
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

  return <AppLayout onCookieSettings={onCookieSettings} hideControls={requestControlsHidden || captureActive}>
    {consentState !== null && consentScreen && <ConsentScreen busy={consentBusy} error={consentError} onChoose={choice => void chooseConsent(choice)} />}
    <div className="contents" hidden={consentState === null || consentScreen}>
      <RequestControlsContext value={setRequestControlsHidden}><CaptureScreenContext value={setCaptureActive}><Outlet /></CaptureScreenContext></RequestControlsContext>
    </div>
  </AppLayout>;
}
