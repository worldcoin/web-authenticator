import {
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  AUTHENTICATOR_UI_STATES_V1,
  type AuthenticatorUiStateIdV1,
  type AuthenticatorUiVisualSourceV1,
} from "@clean-start/contracts";

export type AuthenticatorScreenFamilyV1 =
  | "request"
  | "authenticator"
  | "camera_intro"
  | "capture"
  | "simulation_pending"
  | "verification_complete"
  | "success"
  | "generic";

export interface AuthenticatorScreenDescriptorV1 {
  readonly family: AuthenticatorScreenFamilyV1;
  readonly visualSource: AuthenticatorUiVisualSourceV1;
}

function familyFor(visualSource: AuthenticatorUiVisualSourceV1): AuthenticatorScreenFamilyV1 {
  if (visualSource === "figma_5132_134352") return "request";
  if (visualSource.startsWith("figma_5132_13439") ||
      visualSource === "figma_5132_134441" ||
      visualSource === "figma_5132_134488" ||
      visualSource === "figma_5132_134535" ||
      visualSource === "figma_5132_134582_external") return "authenticator";
  if (visualSource === "figma_5132_134643" || visualSource === "figma_5132_134692_external") {
    return "camera_intro";
  }
  if (
    visualSource === "figma_5132_134743" ||
    visualSource === "figma_5132_134841" ||
    visualSource === "figma_5132_134939"
  ) return "capture";
  if (visualSource === "figma_5132_135038") return "simulation_pending";
  if (visualSource === "figma_5132_135071") return "verification_complete";
  if (visualSource === "figma_5132_135104") return "success";
  return "generic";
}

export const SCREEN_RENDER_REGISTRY_V1 = Object.freeze(Object.fromEntries(
  AUTHENTICATOR_UI_STATES_V1.map((state) => {
    const visualSource = AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[state];
    return [state, Object.freeze({ family: familyFor(visualSource), visualSource })];
  }),
) as Record<AuthenticatorUiStateIdV1, AuthenticatorScreenDescriptorV1>);

export const FIGMA_SCREEN_MATRIX_V1 = Object.freeze({
  verified: Object.freeze([
    "5132:134352",
    "5132:134394",
    "5132:134441",
    "5132:134488",
    "5132:134535",
    "5132:134582",
    "5132:134643",
    "5132:134692",
    "5132:134743",
    "5132:134841",
    "5132:134939",
    "5132:135038",
    "5132:135071",
    "5132:135104",
    "5132:135141",
  ] as const),
  // Every direct frame of section 5132:134348 now has exact design context.
  notFigmaVerified: Object.freeze([] as const),
  // Inspected but not rendered: the dark "face locked" capture variant. The
  // verified base capture frames (134743/134841/134939) are white, and the app
  // follows those.
  verifiedNotRendered: Object.freeze(["5132:135141"] as const),
});
