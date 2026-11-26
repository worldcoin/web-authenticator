import { PROOF_CONTEXT_ORIGIN, type ProtocolEnvironment } from "../../config/environment";

/** Display metadata is optional. Bind both IDs to the validated request before showing a brand. */
export async function loadRequesterName(rpId: string, appId: string, environment: ProtocolEnvironment, signal: AbortSignal): Promise<string | undefined> {
  const response = await fetch(`${PROOF_CONTEXT_ORIGIN}/api/v4/proof-context/${encodeURIComponent(rpId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment }),
    credentials: "omit", referrerPolicy: "no-referrer", signal,
  });
  if (!response.ok) return;
  const brand = await response.json();
  if (brand.rp_id?.toLowerCase() !== rpId.toLowerCase() || brand.app_id !== appId || brand.is_verified !== true) return;
  if (typeof brand.name === "string" && brand.name.trim()) return brand.name.trim();
}
