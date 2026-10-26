import type { SelfieProcessingStep } from "../lib/temporary-selfie-session";
import "./RequestProcessing.css";

const titles: Record<SelfieProcessingStep, string> = {
  "checking-selfie": "Checking your selfie",
  "preparing-credential": "Preparing your credential",
  "creating-proof": "Creating your proof",
  "sending-proof": "Sending your proof",
};

export default function RequestProcessing({ step }: { step: SelfieProcessingStep }) {
  return <div className="request-processing" role="status" aria-live="polite" aria-atomic="true" data-step={step}>
    <h1>{titles[step]}</h1>
  </div>;
}
