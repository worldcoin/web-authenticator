import type { SelfieEnrollmentPolicy } from "../../../lib/selfie-enrollment";

// Always 200 so a missing route (404) is never mistaken for "enrollment switched off".
export function GET(policy: SelfieEnrollmentPolicy | undefined) {
  const body = policy ? { enabled: true, policy } : { enabled: false };
  return () => Response.json(body);
}
