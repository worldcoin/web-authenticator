import { Outlet } from "@tanstack/react-router";
import { createContext, useEffect, useState } from "react";
import { AppLayout } from "./components/AppLayout";
import { ConsentScreen } from "./components/ConsentScreen";
import type { ConsentChoice, ConsentClient, ConsentState } from "./lib/consent";

/** Lets a page hide the shared footer controls while a timed sequence plays. */
export const CompletionAnimationContext = createContext<(active: boolean) => void>(() => {});

/** Chrome and cookie consent around every route. */
export function AppShell({ consent }: { consent: ConsentClient }) {
  const [completionAnimating, setCompletionAnimating] = useState(false);
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

  const footerActions = <span className="inline-flex items-center gap-3 whitespace-nowrap">
    {consentState !== null && consentState !== "unset" && !consentOpen && <button className="min-h-8 text-[13px] hover:text-ink hover:underline" onClick={() => { setConsentError(null); setConsentOpen(true); }}>Cookie settings</button>}
  </span>;

  return <AppLayout footerActions={footerActions} hideControls={completionAnimating}>
    {consentState !== null && consentScreen && <ConsentScreen busy={consentBusy} error={consentError} onChoose={choice => void chooseConsent(choice)} />}
    <div className="contents" hidden={consentState === null || consentScreen}>
      <CompletionAnimationContext value={setCompletionAnimating}><Outlet /></CompletionAnimationContext>
    </div>
  </AppLayout>;
}
