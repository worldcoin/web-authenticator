export function SelfieIndicator({ title, hint }: { title: string; hint: string }) {
  return <div className="selfie-feedback" role="status" aria-live="polite" aria-atomic="true">
    <div className="selfie-guidance"><h2>{title}</h2></div>
    <p className="selfie-hint">{hint}</p>
  </div>;
}

export function CenterFaceIndicator() {
  return <SelfieIndicator title="Look straight ahead" hint="Center your face in the oval and hold still." />;
}

export function TurnHeadIndicator({ direction }: { direction: "left" | "right" }) {
  return <>
    <svg className="selfie-turn-indicator" data-direction={direction} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="m14 8-8 8 8 8M6 16h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <SelfieIndicator title={`Turn your head ${direction}`} hint="Keep looking at the screen while you turn." />
  </>;
}

export function HoldStillIndicator() {
  return <SelfieIndicator title="Hold it there" hint="Keep your eyes on the screen." />;
}

export function EvaluationIndicator() {
  return <SelfieIndicator title="Checking your capture" hint="You can relax. Keep this page open." />;
}
