import { useEffect, useState } from "react";
import "./HeadTurnChallengePreview.css";

// A scripted design preview. These delays and two targets are not biometric rules.
const SCREENS = {
  preparing: { label: "Request challenge", title: "Getting your check ready", hint: "This will only take a moment.", step: 0, direction: "center", hold: false, delay: 1200 },
  center: { label: "Center face", title: "Look straight ahead", hint: "Center your face in the oval and hold still.", step: 0, direction: "center", hold: false, delay: 1800 },
  left: { label: "Turn left", title: "Turn your head left", hint: "Keep looking at the screen while you turn.", step: 1, direction: "left", hold: false, delay: 2200 },
  leftHold: { label: "Hold left", title: "Hold it there", hint: "Keep your eyes on the screen.", step: 1, direction: "left", hold: true, delay: 1000 },
  right: { label: "Turn right", title: "Now turn your head right", hint: "Keep looking at the screen while you turn.", step: 2, direction: "right", hold: false, delay: 2200 },
  rightHold: { label: "Hold right", title: "Hold it there", hint: "Keep your eyes on the screen.", step: 2, direction: "right", hold: true, delay: 1000 },
  evaluating: { label: "Await evaluation", title: "Checking your capture", hint: "You can relax. Keep this page open.", step: 2, direction: "center", hold: false, delay: 1800 },
  complete: { label: "Evaluation passed", title: "Check complete", hint: "Your next step would appear here.", step: 2, direction: "center", hold: false, delay: 0 },
  faceLost: { label: "Face lost", title: "Keep your face in view", hint: "Bring your face back into the oval.", step: 1, direction: "center", hold: false, delay: 0 },
  inconclusive: { label: "Inconclusive", title: "Let’s try that again", hint: "We couldn’t get a clear capture. Find good light and keep your face in view.", step: 0, direction: "center", hold: false, delay: 0 },
  expired: { label: "Challenge expired", title: "This check has expired", hint: "Start a fresh check to try again.", step: 0, direction: "center", hold: false, delay: 0 },
  failed: { label: "Evaluation rejected", title: "We couldn’t complete this check", hint: "Return to the app to start again.", step: 0, direction: "center", hold: false, delay: 0 },
} as const;
type Screen = keyof typeof SCREENS;
const WALKTHROUGH: Screen[] = ["preparing", "center", "left", "leftHold", "right", "rightHold", "evaluating", "complete"];

export function HeadTurnChallengePreview() {
  const [screen, setScreen] = useState<Screen>("center");
  const [playing, setPlaying] = useState(false);
  const state = SCREENS[screen];
  const result = ["complete", "inconclusive", "expired", "failed"].includes(screen);
  const waiting = screen === "preparing" || screen === "evaluating";
  const select = (next: Screen) => { setPlaying(false); setScreen(next); };

  useEffect(() => {
    if (!playing) return;
    const index = WALKTHROUGH.indexOf(screen);
    if (index < 0 || index === WALKTHROUGH.length - 1) return;
    const timer = setTimeout(() => setScreen(WALKTHROUGH[index + 1]!), state.delay);
    return () => clearTimeout(timer);
  }, [playing, screen, state.delay]);

  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);

  return <div className="challenge-preview">
    <aside className="challenge-review" aria-labelledby="draft-title">
      <p className="challenge-eyebrow">Interaction study / 01</p>
      <h1 id="draft-title">A little turn.<br />A clear next step.</h1>
      <p className="challenge-review-copy">Head-left / head-right challenge. One instruction at a time, with a target on the same side as the turn.</p>
      <p className="challenge-draft-note">UI draft · simulated feedback<br />No camera, image capture or TEE connection.</p>
      <div className="challenge-review-actions">
        <button type="button" className="signin-primary" onClick={() => {
          if (playing && screen !== "complete") setPlaying(false);
          else { setScreen("preparing"); setPlaying(true); }
        }}>{playing && screen !== "complete" ? "Pause walkthrough" : "Play walkthrough"}</button>
      </div>
      <nav className="challenge-scenes" aria-label="Preview screens">
        {Object.entries(SCREENS).map(([key, value]) => <button type="button" key={key} aria-current={screen === key ? "step" : undefined} onClick={() => select(key as Screen)}>
          <span className="challenge-scene-dot" aria-hidden="true" />{value.label}
        </button>)}
      </nav>
      <p className="challenge-review-footnote">Two scripted targets explain the interaction. The real target list, timing and decision come from the challenge protocol.</p>
    </aside>

    <div className="challenge-device">
      <header className="challenge-brand">World ID <span>Preview</span></header>
      <main className="challenge-screen" data-screen={screen} data-direction={state.direction} data-hold={state.hold}>
        <div className="challenge-topline">
          <button type="button" className="challenge-close" aria-label="Restart preview" onClick={() => select("center")}><span aria-hidden="true">×</span></button>
          <p>Selfie check</p><span className="challenge-topline-spacer" />
        </div>
        <div className="challenge-stage">
          <p className="challenge-step">{waiting ? screen === "evaluating" ? "Capture finished" : "Connecting" : result ? "" : state.step ? `Turn ${state.step} of 2` : "Get ready"}</p>
          <div className="challenge-visual" aria-hidden="true">
            <svg className="challenge-oval" viewBox="0 0 304 360" fill="none">
              <ellipse className="challenge-oval-track" cx="152" cy="180" rx="119" ry="154" />
              <ellipse className="challenge-oval-dots" cx="152" cy="180" rx="119" ry="154" pathLength="64" />
              <path className="challenge-target challenge-target--left" d="M47 111a119 154 0 0 0 0 138" />
              <path className="challenge-target challenge-target--right" d="M257 111a119 154 0 0 1 0 138" />
              <path className="challenge-direction challenge-direction--left" d="m19 173-7 7 7 7m-7-7h14" />
              <path className="challenge-direction challenge-direction--right" d="m285 173 7 7-7 7m7-7h-14" />
            </svg>
            <div className="challenge-face-field">
              {result ? <svg className="challenge-result-icon" viewBox="0 0 96 96" fill="none">
                <circle cx="48" cy="48" r="35" />
                {screen === "complete" ? <path d="m31 49 11 11 24-25" /> : <path d="M48 28v25m0 12v1" />}
              </svg> : <svg className="challenge-face" viewBox="0 0 180 240" fill="none">
                <path className="challenge-shoulders" d="M19 238v-12c0-25 34-42 71-42s71 17 71 42v12" />
                <g className="challenge-head">
                  <path className="challenge-head-fill" d="M43 83c0-36 18-57 47-57s47 21 47 57c0 43-19 77-47 77S43 126 43 83Z" />
                  <path d="M43 83c0-36 18-57 47-57s47 21 47 57c0 43-19 77-47 77S43 126 43 83Z" />
                  <path d="M62 84h14m28 0h14M90 88v25h8m-21 20c8 5 18 5 26 0" />
                  <circle cx="70" cy="94" r="2.5" /><circle cx="111" cy="94" r="2.5" />
                </g>
              </svg>}
            </div>
            {(waiting || state.hold) && <span className="challenge-measuring" />}
          </div>
          <div className="challenge-guidance" role="status" aria-live="polite" aria-atomic="true">
            <h2>{state.title}</h2><p>{state.hint}</p>
          </div>
          {(screen === "inconclusive" || screen === "expired") && <button type="button" className="signin-primary challenge-retry" onClick={() => select("preparing")}>Start again</button>}
        </div>
        <p className="challenge-camera-note">Illustrated preview · camera off</p>
      </main>
      <footer className="challenge-device-footer"><span>Privacy</span><span>World ID</span></footer>
    </div>
  </div>;
}
