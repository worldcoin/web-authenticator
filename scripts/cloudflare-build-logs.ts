import { appendFile } from "node:fs/promises";

type LogPage = { lines: [number, string][]; cursor?: string; truncated?: boolean };
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

type Request = (url: URL, init: RequestInit) => Promise<Response>;

async function cloudflareRequest(account: string, path: string, token: string, request: Request, body?: object): Promise<unknown> {
  const response = await request(new URL(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`), {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Cloudflare ${body ? "build retry" : "build lookup"} returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("success" in result) || result.success !== true || !("result" in result)) {
    throw new Error("Cloudflare build request was unsuccessful");
  }
  return result.result;
}

export function stagingRetryTarget(build: any, scripts: any, mainCommit: string): string {
  const metadata = build?.build_trigger_metadata;
  const trigger = build?.trigger;
  const worker = Array.isArray(scripts) ? scripts.find(script => script?.id === "web-authenticator-dev") : undefined;
  const checks = {
    mainCommit: /^[a-f0-9]{40}$/.test(mainCommit),
    stopped: build?.status === "stopped",
    failed: build?.build_outcome === "fail",
    mainBranch: metadata?.branch === "main",
    currentCommit: metadata?.commit_hash === mainCommit,
    owner: metadata?.provider_account_name === "worldcoin",
    repository: metadata?.repo_name === "web-authenticator",
    stagingWorker: Boolean(worker?.tag && trigger?.external_script_id === worker.tag),
    triggerId: UUID.test(trigger?.trigger_uuid ?? ""),
  };
  const failures = Object.entries(checks).filter(([, valid]) => !valid).map(([name]) => name);
  if (failures.length) {
    // Only identity/status fields; build metadata also contains environment variables.
    const identity = { status: build?.status, outcome: build?.build_outcome, branch: metadata?.branch,
      commit: metadata?.commit_hash, owner: metadata?.provider_account_name, repository: metadata?.repo_name,
      trigger: trigger?.trigger_uuid, script: trigger?.external_script_id, stagingScript: worker?.tag };
    throw new Error(`Retry requires a failed web-authenticator-dev build for the current main commit; mismatched fields: ${failures.join(", ")}; identity: ${JSON.stringify(identity)}`);
  }
  return trigger.trigger_uuid;
}

export async function retryStagingBuild(account: string, build: string, token: string, mainCommit: string,
  request: Request = fetch): Promise<string> {
  validateInputs(account, build, token);
  const previous = await cloudflareRequest(account, `builds/builds/${build}`, token, request);
  const scripts = await cloudflareRequest(account, "workers/scripts", token, request);
  const trigger = stagingRetryTarget(previous, scripts, mainCommit);
  // Do not retry this POST automatically: a timeout may still have started a build.
  const result: any = await cloudflareRequest(account, `builds/triggers/${trigger}/builds`, token, request,
    { branch: "main", commit_hash: mainCommit });
  if (!UUID.test(result?.build_uuid ?? "")) throw new Error("Cloudflare retry returned no build UUID; inspect build history before retrying");
  return result.build_uuid;
}

function validateInputs(account: string, build: string, token: string) {
  if (!/^[a-f0-9]{32}$/.test(account) || !UUID.test(build)) {
    throw new Error("Provide a Cloudflare account ID and the build UUID from the failed check's Details link");
  }
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is unavailable to this workflow");
}

export function parseLogPage(value: unknown): LogPage {
  if (!value || typeof value !== "object") throw new Error("Invalid Cloudflare log response");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.lines) || !page.lines.every(line =>
    Array.isArray(line) && line.length === 2 && typeof line[0] === "number" && typeof line[1] === "string"
  ) || (page.cursor !== undefined && typeof page.cursor !== "string") ||
    (page.truncated !== undefined && typeof page.truncated !== "boolean")) {
    throw new Error("Invalid Cloudflare log page");
  }
  return page as LogPage;
}

export async function readBuildLogs(account: string, build: string, token: string,
  write: (line: string) => void, request: Request = fetch): Promise<number> {
  validateInputs(account, build, token);
  const seen = new Set<string>();
  let cursor = "";
  let count = 0;
  for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${account}/builds/builds/${build}/logs`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Cloudflare build logs returned HTTP ${response.status}; check Workers CI Read permission and build retention`);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("success" in body) || body.success !== true || !("result" in body)) {
      throw new Error("Cloudflare did not return a successful build-log response");
    }
    const page = parseLogPage(body.result);
    for (const [, message] of page.lines) {
      // Prefix every physical line so build output cannot invoke Actions commands.
      for (const line of message.replaceAll(token, "[REDACTED]").split(/\r\n|\r|\n/)) write(`[Cloudflare] ${line}`);
      count++;
    }
    // Completed logs can retain a cursor for subsequent polling.
    if (page.truncated === false || (page.lines.length === 0 && page.truncated !== true)) return count;
    if (!page.cursor) {
      if (page.truncated) throw new Error("Cloudflare logs are truncated without a continuation cursor");
      return count;
    }
    if (seen.has(page.cursor)) throw new Error("Cloudflare repeated its log cursor; output is incomplete");
    seen.add(page.cursor);
    cursor = page.cursor;
  }
  throw new Error("Cloudflare logs exceeded 50 pages; output is incomplete");
}

if (import.meta.main) {
  const build = process.env.CLOUDFLARE_BUILD_ID ?? "";
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
  let summary: string;
  if (process.env.CLOUDFLARE_BUILD_ACTION === "retry-staging") {
    const response = await fetch("https://api.github.com/repos/worldcoin/web-authenticator/commits/main", {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`GitHub main lookup returned HTTP ${response.status}`);
    const main: unknown = await response.json();
    if (!main || typeof main !== "object" || !("sha" in main) || typeof main.sha !== "string") {
      throw new Error("GitHub main lookup returned no commit SHA");
    }
    const retry = await retryStagingBuild(account, build, token, main.sha);
    summary = `Started staging retry ${retry} for main commit ${main.sha}. Use build-logs with this UUID to inspect progress.\n`;
  } else {
    const count = await readBuildLogs(account, build, token, line => process.stdout.write(`${line}\n`));
    summary = `Retrieved ${count} Cloudflare build-log entries for ${build}. See the Cloudflare build operation step. No deployment or configuration changes were made.\n`;
  }
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
