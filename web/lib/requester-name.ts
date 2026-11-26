/** The server resolves verified metadata for this RP and app in the production registry. */
export async function loadRequesterName(rpId: string, appId: string, signal: AbortSignal): Promise<string | undefined> {
  const query = new URLSearchParams({ rp_id: rpId, app_id: appId });
  const response = await fetch(`/api/requester-name?${query}`, { signal, credentials: "omit", redirect: "error" });
  if (response.status !== 200) return;
  const { name } = await response.json();
  return typeof name === "string" ? name : undefined;
}
