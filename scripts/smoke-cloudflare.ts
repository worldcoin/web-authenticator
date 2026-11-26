import { RELEASE_FILE, type ReleaseManifest } from "../config/build-manifest";
import { APP_ORIGINS } from "../config/environment";
import { securityHeaders } from "../config/security-headers";

/** Verify the live hostname serves the released build, without creating wallets or captures. */
export async function smokeDeployment(environment: "production", commit: string, fetcher: typeof fetch = fetch) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Expected a full release commit SHA");
  const origin = APP_ORIGINS[environment];
  const expectedHeaders = Object.entries(securityHeaders(environment));
  const get = async (path: string, contentType: RegExp) => {
    const response = await fetcher(origin + path, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (response.status !== 200) throw new Error(`Deployment check failed (${response.status}) for ${path}`);
    for (const [name, value] of expectedHeaders) {
      if (response.headers.get(name) !== value) throw new Error(`Unexpected ${name} header for ${path}`);
    }
    // The single-page fallback answers missing files with index.html, so the type proves the file exists.
    if (!contentType.test(response.headers.get("content-type") ?? "")) throw new Error(`Unexpected content type for ${path}`);
    return response;
  };
  const release = await (await get(`/${RELEASE_FILE}`, /^application\/json\b/)).json() as Partial<ReleaseManifest>;
  if (release.environment !== environment || release.commit !== commit) throw new Error("Live deployment does not match the release");
  const page = await get("/verify", /^text\/html\b/);
  // Request links carry the bridge key in their query.
  if (page.headers.get("cache-control") !== "no-store") throw new Error("Request page may be stored by caches");
  const html = await page.text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"#]+)"/g)].map(match => match[1]!);
  if (!scripts.length) throw new Error("Missing browser entry script");
  for (const script of scripts) {
    const url = new URL(script, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/assets/")) throw new Error("Unexpected browser entry origin");
    const asset = await get(url.pathname + url.search, /(?:javascript|ecmascript)/);
    await asset.body?.cancel();
  }
}

if (import.meta.main) {
  const environment = process.argv[2];
  if (environment !== "production") throw new Error("Choose production");
  const commit = process.argv[3] ?? "";
  // Retry only bounded deployment propagation; a permanent mismatch fails the job.
  for (let attempt = 0; ; attempt++) {
    try {
      await smokeDeployment(environment, commit);
      process.stdout.write(`Verified ${APP_ORIGINS[environment]} at ${commit}.\n`);
      break;
    } catch (error) {
      if (attempt === 11) throw error;
      await Bun.sleep(5_000);
    }
  }
}
