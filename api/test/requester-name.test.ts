import { expect, spyOn, test } from "bun:test";
import { GET } from "../routes/api/requester-name";

const app = `app_${"a".repeat(32)}`;
const otherApp = `app_${"b".repeat(32)}`;
const request = (rpId: string, appId = app) => new Request(`https://web.world.org/api/requester-name?rp_id=${rpId}&app_id=${appId}`);

test("verified requester names use the canonical RP ID, match both IDs on cache hits, and expire", async () => {
  const rpId = "rp_000000000000000a";
  const brand = { rp_id: rpId, app_id: app, name: " Example ", is_verified: true };
  const portal = spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(brand));
  const clock = spyOn(Date, "now").mockReturnValue(0);
  try {
    expect(await (await GET(request("RP_A"))).json()).toEqual({ name: "Example" });
    expect(portal).toHaveBeenCalledWith(`https://developer.world.org/api/v4/proof-context/${rpId}`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ environment: "production" }), redirect: "manual",
    }));
    expect((await GET(request(rpId, otherApp))).status).toBe(204);
    expect(await (await GET(request(rpId))).json()).toEqual({ name: "Example" });
    expect(portal).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(5 * 60_000);
    portal.mockResolvedValueOnce(Response.json({ ...brand, name: "Renamed" }));
    expect(await (await GET(request(rpId))).json()).toEqual({ name: "Renamed" });
  } finally { clock.mockRestore(); portal.mockRestore(); }
});

test("invalid IDs, unverified or mismatched metadata, and upstream failures never produce a name", async () => {
  const rpId = "rp_000000000000000b";
  const brand = { rp_id: rpId, app_id: app, name: "Example", is_verified: true };
  const portal = spyOn(globalThis, "fetch");
  try {
    expect((await GET(request("rp_123456789abcdef01"))).status).toBe(400);
    expect((await GET(request(rpId, "invalid"))).status).toBe(400);
    expect(portal).not.toHaveBeenCalled();
    for (const metadata of [null, { ...brand, is_verified: false }, { ...brand, rp_id: "rp_1" },
      { ...brand, app_id: otherApp }, { ...brand, name: " " }]) {
      portal.mockResolvedValueOnce(Response.json(metadata));
      expect((await GET(request(rpId))).status).toBe(204);
    }
    portal.mockRejectedValueOnce(new TypeError("offline"));
    expect((await GET(request(rpId))).status).toBe(502);
    portal.mockResolvedValueOnce(Response.json(brand));
    expect(await (await GET(request(rpId))).json()).toEqual({ name: "Example" });
  } finally { portal.mockRestore(); }
});
