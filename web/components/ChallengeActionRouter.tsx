import { CenterFaceIndicator, EvaluationIndicator, HoldStillIndicator, TurnHeadIndicator } from "./SelfieIndicators";

export type ChallengeAction = { id: string } & (
  | { type: "center_face" | "hold_still" | "evaluate" }
  | { type: "turn_head"; direction: "left" | "right" }
);

/** UI input: the server owns the sequence and which action is active. */
export type ChallengeActionTranscript = {
  actions: readonly ChallengeAction[];
  activeActionId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is ChallengeAction {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.length || value.id.length > 128) return false;
  switch (value.type) {
    case "center_face": case "hold_still": case "evaluate": return true;
    case "turn_head": return value.direction === "left" || value.direction === "right";
    default: return false;
  }
}

/** Validate received data before choosing a component; never infer a next action. */
export function activeChallengeAction(transcript: unknown): ChallengeAction | undefined {
  if (!isRecord(transcript) || typeof transcript.activeActionId !== "string" ||
    !Array.isArray(transcript.actions) || !transcript.actions.length || transcript.actions.length > 64) return;
  const ids = new Set<string>();
  let active: ChallengeAction | undefined;
  for (const action of transcript.actions) {
    if (!isAction(action) || ids.has(action.id)) return;
    ids.add(action.id);
    if (action.id === transcript.activeActionId) active = action;
  }
  return active;
}

export function ChallengeActionRouter({ transcript }: { transcript: unknown }) {
  const action = activeChallengeAction(transcript);
  if (!action) return <div className="selfie-feedback" role="alert">
    <div className="selfie-guidance"><h2>This check can’t continue</h2></div>
    <p className="selfie-hint">The challenge step is missing or unsupported. Start a fresh check.</p>
  </div>;
  switch (action.type) {
    case "center_face": return <CenterFaceIndicator />;
    case "turn_head": return <TurnHeadIndicator direction={action.direction} />;
    case "hold_still": return <HoldStillIndicator />;
    case "evaluate": return <EvaluationIndicator />;
  }
}
