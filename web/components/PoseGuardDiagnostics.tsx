import { useState, useSyncExternalStore } from "react";
import { currentProtocolEnvironment } from "../lib/environment";
import type { EngineCheck } from "../lib/poseguard/engine-checks";
import {
  clearDiagnostics, diagnosticAttempts, diagnosticBundle, subscribeDiagnostics, TEE_ONLY_CHECKS,
  type DiagnosticAttempt, type DiagnosticStep,
} from "../lib/poseguard/diagnostics";

/** Dev-only PoseGuard capture diagnostics: what each step captured and sent, and where the attempt failed. */
export default function PoseGuardDiagnostics() {
  const attempts = useSyncExternalStore(subscribeDiagnostics, diagnosticAttempts);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [downloadError, setDownloadError] = useState<string>();
  const attempt = attempts.find(value => value.id === selected) ?? attempts[0];
  const failed = attempt?.outcome && attempt.outcome.status !== "accepted";

  return <>
    <button type="button" onClick={() => setOpen(value => !value)} data-testid="poseguard-diagnostics-toggle"
      className={`fixed right-2 bottom-2 z-[60] rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-white shadow ${failed ? "bg-[#b42318]" : "bg-[#1f1f1f]"}`}>
      PoseGuard debug{attempt?.outcome ? ` · ${outcomeLabel(attempt)}` : ""}
    </button>
    {open && <aside aria-label="PoseGuard diagnostics" data-testid="poseguard-diagnostics"
      className="fixed inset-y-0 right-0 z-[60] w-[min(440px,100vw)] overflow-y-auto border-l border-[#d0d0d0] bg-white p-3 font-mono text-[11px] leading-[1.4] text-[#1f1f1f] shadow-xl">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <strong className="text-[12px]">PoseGuard debug (dev only)</strong>
        {attempts.length > 1 && <select className="border border-[#d0d0d0] px-1" value={attempt?.id} onChange={event => setSelected(Number(event.target.value))} aria-label="Attempt">
          {attempts.map(value => <option key={value.id} value={value.id}>#{value.id} {value.startedAt.slice(11, 19)} {outcomeLabel(value)}</option>)}
        </select>}
        <span className="flex-1" />
        {attempt && <button type="button" className="underline" onClick={() => {
          setDownloadError(undefined);
          download(attempt).catch(error => setDownloadError(error instanceof Error ? error.message : String(error)));
        }}>Download bundle</button>}
        <button type="button" className="underline" onClick={() => { clearDiagnostics(); setSelected(undefined); }}>Clear</button>
        <button type="button" className="underline" onClick={() => setOpen(false)}>Close</button>
      </header>
      {downloadError && <p className="mb-2 text-[#b42318]">Could not build the bundle: {downloadError}</p>}
      {!attempt ? <p>No capture yet.</p> : <>
        <Outcome attempt={attempt} />
        {attempt.steps.length === 0 && <p>Waiting for the TEE prompt.</p>}
        {attempt.steps.map(step => <Step key={step.step} step={step} failed={attempt.outcome?.status === "rejected" && attempt.outcome.step === step.step} />)}
        <p className="mt-3 text-[#6b6b6b]">Checked by the TEE only: {TEE_ONLY_CHECKS.join("; ")}.</p>
        <p className="mt-1 text-[#6b6b6b]">Angles use FaceEngine signs (pitch up is positive). Local checks use the TEE's own thresholds.</p>
      </>}
    </aside>}
  </>;
}

function Outcome({ attempt }: { attempt: DiagnosticAttempt }) {
  const { outcome } = attempt;
  if (!outcome) return <p className="mb-2">In progress.</p>;
  if (outcome.status === "accepted") return <p className="mb-2 text-[#067647]">TEE accepted all frames.</p>;
  if (outcome.status === "error") return <p className="mb-2 text-[#b42318]">Ended before a TEE verdict: {outcome.message}</p>;
  return <p className="mb-2 text-[#b42318]">
    TEE rejected {outcome.step ? `step ${outcome.step}` : "the request"}: <strong>{outcome.reason}</strong>.
    {outcome.reason === "quality_rejected" && " The TEE does not say which check failed; compare the failing local checks below and the TEE-only list."}
  </p>;
}

function Step({ step, failed }: { step: DiagnosticStep; failed: boolean }) {
  const { frame, target } = step;
  return <section className={`mt-2 rounded border p-2 ${failed ? "border-[#b42318] bg-[#fef3f2]" : "border-[#e4e4e4]"}`} data-testid="poseguard-diagnostics-step">
    <div className="flex gap-2">
      {frame && <img src={frame.imageUrl} alt={`Step ${step.step} capture`} className="h-24 w-auto shrink-0 rounded object-contain" />}
      <div className="min-w-0 flex-1">
        <div><strong>Step {step.step}</strong> {target ? `target yaw ${target.yaw}° pitch ${target.pitch}°` : "central"}{failed && <strong className="text-[#b42318]"> ← rejected</strong>}</div>
        {frame ? <>
          <div>measured yaw {fixed(frame.pose.yaw)}° pitch {fixed(frame.pose.pitch)}° roll {fixed(frame.pose.roll)}°</div>
          <div>{frame.width}×{frame.height} PNG, {(frame.bytes / 1024).toFixed(0)} KiB</div>
          <div>held {frame.heldMs} ms, step took {frame.durationMs} ms</div>
          <div>box l{fixed(frame.box.left, 2)} t{fixed(frame.box.top, 2)} r{fixed(frame.box.right, 2)} b{fixed(frame.box.bottom, 2)}</div>
        </> : <div>Not captured.</div>}
        <div className="text-[#6b6b6b]">frames by gate: {Object.entries(step.gates).map(([gate, count]) => `${gate} ${count}`).join(", ") || "none"}</div>
      </div>
    </div>
    {frame && <Checks checks={frame.checks} />}
    {frame?.illuminationError && <p className="mt-1 text-[#b42318]">Illumination not checked: {frame.illuminationError}</p>}
  </section>;
}

function Checks({ checks }: { checks: EngineCheck[] }) {
  return <table className="mt-1 w-full border-collapse">
    <tbody>
      {checks.map((check, index) => <tr key={index} className={check.passed ? "" : "text-[#b42318]"}>
        <td className="pr-1 align-top">{check.passed ? "✓" : "✗"}</td>
        <td className="pr-1 align-top">{check.passed ? check.check : `${check.check} → ${check.reason}`}</td>
        <td className="pr-1 text-right align-top">{fixed(check.value, Math.abs(check.value) < 1 ? 3 : 1)}</td>
        <td className="align-top text-[#6b6b6b]">{check.limit}</td>
      </tr>)}
    </tbody>
  </table>;
}

function outcomeLabel(attempt: DiagnosticAttempt): string {
  const { outcome } = attempt;
  if (!outcome) return "running";
  if (outcome.status === "rejected") return `${outcome.reason}${outcome.step ? ` @${outcome.step}` : ""}`;
  return outcome.status;
}

function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

async function download(attempt: DiagnosticAttempt) {
  const url = URL.createObjectURL(await diagnosticBundle(attempt, currentProtocolEnvironment()));
  const link = document.createElement("a");
  link.href = url;
  link.download = `poseguard-debug-${attempt.startedAt.replace(/[:.]/g, "-")}.json`;
  link.click();
  // The browser reads the URL after click() returns; revoking it too early can cancel a large download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
