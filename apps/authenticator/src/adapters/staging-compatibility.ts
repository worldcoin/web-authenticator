import type {
  ApprovedCaptureEntry,
} from "@clean-start/frame-capture";
import type {
  BrowserAdmissionDecisionV1,
} from "@clean-start/browser-admission";
import {
  isSimulatorBrowserDemoAuthenticatorReadyV0,
  type SimulatorBrowserDemoAuthenticatorReadyV0,
} from "@clean-start/contracts";

export function makeExplicitStagingCaptureEntryV0(input: {
  readonly admission: BrowserAdmissionDecisionV1;
  readonly ready: SimulatorBrowserDemoAuthenticatorReadyV0;
  readonly userActivated: boolean;
}): ApprovedCaptureEntry {
  const { admission, ready } = input;
  if (
    admission.outcome !== "eligible_candidate" ||
    admission.mayStartSensitiveFlow !== true ||
    admission.iosVersionBand !== "ios_18_plus" ||
    (admission.browser !== "safari" && admission.browser !== "chrome") ||
    !isSimulatorBrowserDemoAuthenticatorReadyV0(ready) ||
    ready.claims.webauthnPerformed !== false ||
    ready.claims.prfEvaluated !== false ||
    ready.claims.worldIdCreated !== false
  ) {
    throw new TypeError("staging_capture_gate_not_satisfied");
  }

  return Object.freeze({
    userActivated: input.userActivated,
    secureTopLevelContextApproved: true,
    // Compatibility translation only. The ready object above explicitly proves
    // that no PRF operation happened, and this value is never rendered as fact.
    prfReady: true,
    iosMajor: 18,
    browser: admission.browser,
  });
}
