import type {
  AdvisoryCapabilitiesV1,
  AvailabilityV1,
  BrowserProbeRuntimeV1,
  VisibilityV1,
} from "./types";

function availability(value: boolean): AvailabilityV1 {
  return value ? "available" : "unavailable";
}

function visibility(value: string | undefined): VisibilityV1 {
  return value === "visible" || value === "hidden" || value === "prerender" ? value : "unknown";
}

async function safeBooleanProbe(
  probe: (() => Promise<boolean>) | undefined,
): Promise<AvailabilityV1> {
  if (!probe) return "unknown";
  try {
    return availability(await probe());
  } catch {
    return "unknown";
  }
}

export async function collectAdvisoryCapabilitiesV1(
  runtime: BrowserProbeRuntimeV1,
): Promise<AdvisoryCapabilitiesV1> {
  const publicKeyCredential = runtime.publicKeyCredential;
  const webAuthnApi: AvailabilityV1 = publicKeyCredential ? "available" : "unavailable";

  let clientCapabilitiesApi: AvailabilityV1 = "unknown";
  if (publicKeyCredential?.getClientCapabilities) {
    try {
      await publicKeyCredential.getClientCapabilities();
      clientCapabilitiesApi = "available";
    } catch {
      clientCapabilitiesApi = "unknown";
    }
  }

  return {
    secureContext: runtime.isSecureContext,
    webAuthnApi,
    platformUv: await safeBooleanProbe(
      publicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable,
    ),
    clientCapabilitiesApi,
    conditionalMediation: await safeBooleanProbe(
      publicKeyCredential?.isConditionalMediationAvailable,
    ),
    mediaApi: availability(typeof runtime.mediaDevices?.getUserMedia === "function"),
    visibility: visibility(runtime.visibilityState),
  };
}
