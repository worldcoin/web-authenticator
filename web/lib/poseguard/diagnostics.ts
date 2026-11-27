import type { SelfieCaptureFailure } from "@worldcoin/walletkit-web";
import type { CapturedPoseFrame, PoseGuardCaptureObserver } from "./capture";
import { enginePose, engineChecks, type EngineCheck, type EnginePose, type EngineTarget } from "./engine-checks";
import type { PoseGate, PoseObservation } from "./types";

// Dev-only: callers create a recorder only under import.meta.env.DEV, so production keeps no images.

const KEPT_ATTEMPTS = 3;

/** Quality checks the TEE worker (v0.3.0) runs that need models or filters the browser does not have. */
export const TEE_ONLY_CHECKS: readonly string[] = [
  "occlusion (glasses 0.6, mask 0.6, other 0.35)",
  "eyes closed (≤ 0.2)",
  "sharpness (3.084)",
  "over/underexposure (0.5309 / 0.2422)",
  "colour distortion (1.0)",
  "uneven lighting (0.3)",
  "bright artifacts (0.2511)",
  "low contrast (0.8259)",
  "LightQNet (0.58)",
  "FASNet anti-spoof, central only (0.24)",
  "identity similarity central vs challenge (≥ 0.4)",
];

export type DiagnosticFrame = {
  pose: EnginePose;
  box: Pick<PoseObservation, "left" | "top" | "right" | "bottom">;
  width: number;
  height: number;
  bytes: number;
  heldMs: number;
  durationMs: number;
  /** A blob: URL of the PNG that was sent; revoked when the attempt is dropped. */
  imageUrl: string;
  checks: EngineCheck[];
  /** Why the illumination checks are missing, when the PNG could not be decoded. */
  illuminationError?: string;
};

export type DiagnosticStep = {
  step: number;
  target: EngineTarget | null;
  /** How many camera frames each gate saw while this step was shown. */
  gates: Partial<Record<PoseGate, number>>;
  frame?: DiagnosticFrame;
};

export type DiagnosticOutcome =
  | { status: "accepted" }
  | { status: "rejected"; step: number | null; reason: string }
  | { status: "error"; message: string };

export type DiagnosticAttempt = {
  id: number;
  startedAt: string;
  steps: DiagnosticStep[];
  outcome?: DiagnosticOutcome;
};

export interface CaptureDiagnostics extends PoseGuardCaptureObserver {
  rejected(failure: SelfieCaptureFailure): void;
  accepted(): void;
  failed(error: unknown): void;
}

let attempts: readonly DiagnosticAttempt[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Newest first. */
export function diagnosticAttempts(): readonly DiagnosticAttempt[] {
  return attempts;
}

export function clearDiagnostics() {
  for (const attempt of attempts) revoke(attempt);
  publish([]);
}

/** Records one capture attempt; the TEE outcome is attached to the step it names. */
export function recordCaptureAttempt(): CaptureDiagnostics {
  const id = nextId++;
  const dropped = attempts.slice(KEPT_ATTEMPTS - 1);
  for (const attempt of dropped) revoke(attempt);
  publish([{ id, startedAt: new Date().toISOString(), steps: [] }, ...attempts.slice(0, KEPT_ATTEMPTS - 1)]);
  // Counted here and published when the gate changes, so the hot frame loop does not re-render on every frame.
  const gateCounts = new Map<number, Partial<Record<PoseGate, number>>>();
  let lastGate: { step: number; gate: PoseGate } | undefined;
  const current = () => attempts.find(attempt => attempt.id === id);
  const change = (edit: (attempt: DiagnosticAttempt) => DiagnosticAttempt) => {
    if (current()) publish(attempts.map(attempt => attempt.id === id ? edit(attempt) : attempt));
  };
  const changeStep = (step: number, edit: (value: DiagnosticStep) => DiagnosticStep) =>
    change(attempt => ({ ...attempt, steps: attempt.steps.map(value => value.step === step ? edit(value) : value) }));
  const flushGates = (step: number) => changeStep(step, value => ({ ...value, gates: { ...gateCounts.get(step) } }));
  const finish = (outcome: DiagnosticOutcome) => {
    if (current()?.outcome) return;
    if (lastGate) flushGates(lastGate.step);
    change(attempt => ({ ...attempt, outcome }));
  };

  return {
    started(targets) {
      change(attempt => ({
        ...attempt,
        steps: [null, ...targets].map((target, index) => ({ step: index + 1, target, gates: {} })),
      }));
    },
    gated(step, gate) {
      const counts = gateCounts.get(step) ?? {};
      counts[gate] = (counts[gate] ?? 0) + 1;
      gateCounts.set(step, counts);
      if (lastGate?.step === step && lastGate.gate === gate) return;
      if (lastGate && lastGate.step !== step) flushGates(lastGate.step);
      lastGate = { step, gate };
      flushGates(step);
    },
    captured(frame) {
      // A cleared attempt keeps no images: its blob URL could never be revoked.
      if (!current()) return;
      flushGates(frame.step);
      // The PNG is zeroed once the enrollment ends; the Blob holds its own copy.
      const blob = new Blob([frame.png.slice()], { type: "image/png" });
      const imageUrl = URL.createObjectURL(blob);
      const base = diagnosticFrame(frame, blob.size, imageUrl);
      changeStep(frame.step, value => ({ ...value, frame: base }));
      const update = (edit: (value: DiagnosticFrame) => DiagnosticFrame) =>
        changeStep(frame.step, value => value.frame?.imageUrl === imageUrl ? { ...value, frame: edit(value.frame) } : value);
      framePixels(blob).then(
        pixels => {
          const checks = engineChecks({ pose: frame.pose, width: frame.size[0], height: frame.size[1], target: frame.target }, pixels);
          pixels.fill(0);
          update(value => ({ ...value, checks }));
        },
        error => update(value => ({ ...value, illuminationError: errorMessage(error) })),
      );
    },
    accepted() {
      finish({ status: "accepted" });
    },
    rejected(failure) {
      finish(failure.reason === "challenge"
        ? { status: "rejected", step: failure.index + 2, reason: failure.challengeReason }
        // Every failure without a challenge index is about the central frame.
        : { status: "rejected", step: failure.reason === "invalid_request" ? null : 1, reason: failure.reason });
    },
    failed(error) {
      finish({ status: "error", message: errorMessage(error) });
    },
  };
}

/** A JSON bundle of the attempt, with the PNGs inline so they can be replayed through the face engine. */
export async function diagnosticBundle(attempt: DiagnosticAttempt, environment: string): Promise<Blob> {
  const steps = await Promise.all(attempt.steps.map(async step => ({
    ...step,
    frame: step.frame && { ...step.frame, imageUrl: undefined, png: await dataUrl(step.frame.imageUrl) },
  })));
  const { outcome } = attempt;
  return new Blob([JSON.stringify({
    metadata: {
      os: "web",
      userAgent: navigator.userAgent,
      environment,
      faceAuthPurpose: "selfieEnrollment",
      result: outcome?.status === "accepted" ? "success" : "failure",
      terminationReason: outcome?.status === "rejected" ? outcome.reason : outcome?.status ?? "incomplete",
    },
    attempt: { ...attempt, steps },
    teeOnlyChecks: TEE_ONLY_CHECKS,
  }, null, 2)], { type: "application/json" });
}

function diagnosticFrame(frame: CapturedPoseFrame, bytes: number, imageUrl: string): DiagnosticFrame {
  const { left, top, right, bottom } = frame.pose;
  return {
    pose: enginePose(frame.pose),
    box: { left, top, right, bottom },
    width: frame.size[0],
    height: frame.size[1],
    bytes,
    heldMs: frame.heldMs,
    durationMs: frame.durationMs,
    imageUrl,
    checks: engineChecks({ pose: frame.pose, width: frame.size[0], height: frame.size[1], target: frame.target }),
  };
}

async function framePixels(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    canvas.width = canvas.height = 1;
    return data;
  } finally {
    bitmap.close();
  }
}

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the frame."));
    reader.readAsDataURL(blob);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function revoke(attempt: DiagnosticAttempt) {
  for (const step of attempt.steps) if (step.frame) URL.revokeObjectURL(step.frame.imageUrl);
}

function publish(next: readonly DiagnosticAttempt[]) {
  attempts = next;
  for (const listener of listeners) listener();
}
