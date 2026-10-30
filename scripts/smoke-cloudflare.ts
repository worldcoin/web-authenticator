import { DEPLOYMENTS, type DeploymentEnvironment } from "../packages/contracts/src/deployment";

/** Verify the live hostname and deployed version, without creating wallets or captures. */
export async function smokeDeployment(environment: "sandbox" | "production", commit: string, fetcher: typeof fetch = fetch) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Expected a full release commit SHA");
  const deployment = DEPLOYMENTS[environment];
  const get = async (path: string) => {
    const response = await fetcher(deployment.origin + path, {
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) throw new Error(`Deployment check failed (${response.status}) for ${path}`);
    if (response.headers.get("cache-control") !== "no-store") throw new Error("Missing cache protection");
    if (response.headers.get("x-content-type-options") !== "nosniff") throw new Error("Missing content-type protection");
    return response;
  };
  const health = await (await get("/api/health/ready")).json() as Record<string, unknown>;
  if (health.status !== "ready" || health.environment !== environment || health.protocol !== deployment.protocol ||
    health.origin !== deployment.origin || health.commit !== commit) throw new Error("Live deployment does not match the release");
  const page = await get("/verify");
  if (!page.headers.get("content-type")?.includes("text/html")) throw new Error("Missing authenticator HTML");
  const html = await page.text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"#]+)"/g)].map(match => match[1]!);
  if (!scripts.length) throw new Error("Missing browser entry script");
  for (const script of scripts) {
    const url = new URL(script, deployment.origin);
    if (url.origin !== deployment.origin || !url.pathname.startsWith("/assets/")) throw new Error("Unexpected browser entry origin");
    const asset = await get(url.pathname + url.search);
    if (!/(?:javascript|ecmascript)/.test(asset.headers.get("content-type") ?? "")) throw new Error("Browser entry is unavailable");
    await asset.body?.cancel();
  }
}

if (import.meta.main) {
  const environment = process.argv[2] as DeploymentEnvironment;
  if (environment !== "sandbox" && environment !== "production") throw new Error("Choose sandbox or production");
  const commit = process.argv[3] ?? "";
  // Retry only bounded deployment propagation; a permanent mismatch fails the job.
  for (let attempt = 0; ; attempt++) {
    try {
      await smokeDeployment(environment, commit);
      process.stdout.write(`Verified ${DEPLOYMENTS[environment].origin} at ${commit}.\n`);
      break;
    } catch (error) {
      if (attempt === 11) throw error;
      await Bun.sleep(5_000);
    }
  }
}
