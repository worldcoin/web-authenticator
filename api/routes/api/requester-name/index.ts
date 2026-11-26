import { z } from "zod";

const verifiedBrand = z.object({
  rp_id: z.string(),
  app_id: z.string(),
  is_verified: z.literal(true),
  name: z.string().trim().min(1).max(256),
});
const names = new Map<string, { appId: string; name: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 256;

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const id = query.get("rp_id");
  const appId = query.get("app_id")?.toLowerCase();
  if (!id || !/^rp_[0-9a-f]{1,16}$/i.test(id) || !appId || !/^app_[0-9a-f]{32}$/.test(appId)) {
    return Response.json({ error: "Invalid RP or app ID." }, { status: 400 });
  }
  const rpId = "rp_" + id.slice(3).toLowerCase().padStart(16, "0");
  const cached = names.get(rpId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.appId === appId ? Response.json({ name: cached.name }) : new Response(null, { status: 204 });
  }
  try {
    const response = await fetch(`https://developer.world.org/api/v4/proof-context/${rpId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment: "production" }),
      redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(4_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return new Response(null, { status: 204 });
    }
    const brand = verifiedBrand.safeParse(await response.json());
    if (!brand.success || brand.data.rp_id.toLowerCase() !== rpId || brand.data.app_id.toLowerCase() !== appId) {
      return new Response(null, { status: 204 });
    }
    names.delete(rpId);
    if (names.size >= CACHE_LIMIT) names.delete(names.keys().next().value!);
    names.set(rpId, { appId, name: brand.data.name, expiresAt: Date.now() + CACHE_TTL_MS });
    return Response.json({ name: brand.data.name });
  } catch {
    return new Response(null, { status: 502 });
  }
}
