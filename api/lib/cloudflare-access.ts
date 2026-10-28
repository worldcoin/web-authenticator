import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

type AccessConfig = Pick<Env, "CF_ACCESS_TEAM_DOMAIN" | "CF_ACCESS_AUD">;

// Only public verification keys are cached; no user identities or tokens.
export function createAccessVerifier(fetchKeys: (url: string, init?: RequestInit) => Promise<Response> = fetch) {
  const resolvers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  return async (request: Request, env: AccessConfig): Promise<Response | undefined> => {
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.CF_ACCESS_TEAM_DOMAIN) || !env.CF_ACCESS_AUD) {
      return Response.json({ error: "Cloudflare Access is not configured" }, { status: 503 });
    }
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) return Response.json({ error: "TFH login required" }, { status: 403 });
    const issuer = `https://${env.CF_ACCESS_TEAM_DOMAIN}`;
    let keys = resolvers.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { [customFetch]: fetchKeys });
      resolvers.set(issuer, keys);
    }
    try {
      await jwtVerify(token, keys, {
        algorithms: ["RS256"], issuer, audience: env.CF_ACCESS_AUD,
        requiredClaims: ["exp", "iat", "sub"],
      });
      return undefined;
    } catch {
      return Response.json({ error: "TFH login required" }, { status: 403 });
    }
  };
}
