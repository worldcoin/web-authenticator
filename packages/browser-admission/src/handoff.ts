import {
  BROWSER_ADMISSION_V1,
  type ExternalBrowserHandoffV1,
  type ValidatedHandoffContextV1,
} from "./types";

const OPAQUE_HANDLE_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;

function requireCanonicalHttpsOrigin(value: string): URL {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.origin !== value
  ) {
    throw new TypeError("A canonical HTTPS handoff origin is required");
  }
  return parsed;
}

function requireOpaqueHandle(value: string): void {
  if (!OPAQUE_HANDLE_PATTERN.test(value)) {
    throw new TypeError("A valid opaque server handle is required");
  }
}

export function createExternalBrowserHandoffV1(
  authenticatorOrigin: string,
  context: ValidatedHandoffContextV1,
): ExternalBrowserHandoffV1 {
  if (context.validation !== "server_validated") {
    throw new TypeError("Server-validated handoff context is required");
  }
  requireOpaqueHandle(context.transactionHandle);
  requireOpaqueHandle(context.returnTargetHandle);

  const href = new URL("/continue", requireCanonicalHttpsOrigin(authenticatorOrigin));
  href.searchParams.set("transaction", context.transactionHandle);
  href.searchParams.set("return_target", context.returnTargetHandle);

  return {
    version: BROWSER_ADMISSION_V1,
    href: href.href,
    carries: "validated_opaque_handles_only",
    challengeAction: "invalidate_and_reissue_after_navigation",
  };
}
