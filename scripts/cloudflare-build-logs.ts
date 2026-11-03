import { appendFile } from "node:fs/promises";

type LogPage = { lines: [number, string][]; cursor?: string; truncated?: boolean };

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
  write: (line: string) => void, request: (url: URL, init: RequestInit) => Promise<Response> = fetch): Promise<number> {
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(build)) {
    throw new Error("Provide a Cloudflare account ID and the build UUID from the failed check's Details link");
  }
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is unavailable to this workflow");
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
  const count = await readBuildLogs(process.env.CLOUDFLARE_ACCOUNT_ID ?? "", build,
    process.env.CLOUDFLARE_API_TOKEN ?? "", line => process.stdout.write(`${line}\n`));
  const summary = `Retrieved ${count} Cloudflare build-log entries for ${build}. See the Read Cloudflare build logs step. No deployment or configuration changes were made.\n`;
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
