import { expect, test } from "bun:test";
import { parseLogPage, readBuildLogs } from "../../scripts/cloudflare-build-logs";

const account = "a".repeat(32);
const build = "36a70ab1-48cf-4d22-8b3c-ad2cb407b2a3";

function pages(...results: unknown[]) {
  return (async () => Response.json({ success: true, result: results.shift() }));
}

test("reads every page, masks the credential, and prevents Actions command injection", async () => {
  const output: string[] = [];
  const urls: string[] = [];
  const request = (async (url: URL, init: RequestInit) => {
    urls.push(url.href);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return Response.json({ success: true, result: urls.length === 1
      ? { lines: [[1, "secret-token\n::error::not a workflow command"]], cursor: "next/page", truncated: true }
      : { lines: [[2, "build failed"]] } });
  });
  expect(await readBuildLogs(account, build, "secret-token", line => output.push(line), request)).toBe(2);
  expect(urls[1]).toContain("cursor=next%2Fpage");
  expect(output).toEqual(["[Cloudflare] [REDACTED]", "[Cloudflare] ::error::not a workflow command", "[Cloudflare] build failed"]);
});

test("rejects invalid identifiers before making a request", async () => {
  await expect(readBuildLogs(account, "../tokens", "token", () => { throw new Error("Unexpected output"); }))
    .rejects.toThrow("build UUID");
});

test("surfaces API failures without printing response bodies", async () => {
  const request = (async () => new Response("sensitive response", { status: 403 }));
  await expect(readBuildLogs(account, build, "token", () => {}, request)).rejects.toThrow("HTTP 403");
  await expect(readBuildLogs(account, build, "token", () => {},
    (async () => Response.json({ success: false })))).rejects.toThrow("successful");
});

test("rejects malformed logs and reports incomplete pagination", async () => {
  expect(() => parseLogPage({ lines: [[1, {}]] })).toThrow("Invalid Cloudflare log page");
  await expect(readBuildLogs(account, build, "token", () => {}, pages({ lines: [], truncated: true })))
    .rejects.toThrow("truncated");
  await expect(readBuildLogs(account, build, "token", () => {}, pages(
    { lines: [], cursor: "same" }, { lines: [], cursor: "same" }))).rejects.toThrow("repeated");
});
