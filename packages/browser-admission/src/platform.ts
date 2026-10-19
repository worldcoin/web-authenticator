import type {
  BrowserFamilyV1,
  DetectedIPhonePlatformV1,
  IosVersionBandV1,
} from "./types";

const IOS_VERSION_PATTERN = /(?:CPU iPhone OS|iPhone OS) (\d+)(?:[_.]\d+)?/;

export function classifyIPhoneUserAgentV1(userAgent: string): DetectedIPhonePlatformV1 {
  if (!/\biPhone\b/.test(userAgent)) {
    return { device: userAgent.length === 0 ? "unknown" : "other", iosMajor: null, browser: "unknown" };
  }

  const versionMatch = IOS_VERSION_PATTERN.exec(userAgent);
  const parsedMajor = versionMatch ? Number.parseInt(versionMatch[1] ?? "", 10) : Number.NaN;
  const iosMajor = Number.isInteger(parsedMajor) && parsedMajor > 0 ? parsedMajor : null;

  let browser: BrowserFamilyV1 = "unknown";
  if (/\bCriOS\//.test(userAgent)) {
    browser = "chrome";
  } else if (
    /\bAppleWebKit\//.test(userAgent) &&
    /\bMobile\//.test(userAgent) &&
    /\bSafari\//.test(userAgent) &&
    !/\b(?:FxiOS|EdgiOS|OPiOS)\//.test(userAgent)
  ) {
    browser = "safari";
  } else if (/\b(?:FxiOS|EdgiOS|OPiOS)\//.test(userAgent)) {
    browser = "other";
  }

  return { device: "iphone", iosMajor, browser };
}

export function iosVersionBandV1(iosMajor: number | null): IosVersionBandV1 {
  if (iosMajor === null) return "unknown";
  if (iosMajor >= 15 && iosMajor <= 17) return "ios_15_17";
  if (iosMajor >= 18) return "ios_18_plus";
  return "other";
}
