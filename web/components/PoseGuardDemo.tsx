import { lazy, Suspense, useState } from "react";
import { AppLayout } from "./AppLayout";
import "./PoseGuard.css";

const SelfieCheck = lazy(() => import("./SelfieCheck"));

/** Repeatable client-only entry point; no IDKit request, enrollment or credential issuance. */
export function PoseGuardDemo() {
  const [started, setStarted] = useState(false);
  return <AppLayout footerActions={null}>
    <div className="poseguard-demo">
      {started ? <Suspense fallback={<p role="status">Opening the movement check…</p>}>
        <SelfieCheck poseguard onClose={() => setStarted(false)} backLabel="Close movement check" />
      </Suspense> : <div className="poseguard-demo-intro">
        <img src="/assets/figma/request-selfie-emblem.svg" alt="" />
        <h1>Try a movement check</h1>
        <p>Keep looking at the dot while turning your head in four directions. Hold your phone still.</p>
        <button className="primary-action" onClick={() => setStarted(true)}>Start check</button>
        <p className="poseguard-demo-note">Camera images stay on this device. This demo does not issue a credential.</p>
      </div>}
    </div>
  </AppLayout>;
}
