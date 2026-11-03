import { expect, test } from "bun:test";
import { parseLogPage, readBuildLogs, retryStagingBuild, stagingRetryTarget } from "../../scripts/cloudflare-build-logs";

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
      : { lines: [[2, "build failed"]], cursor: "end", truncated: false } });
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
    { lines: [], cursor: "same", truncated: true }, { lines: [], cursor: "same", truncated: true }))).rejects.toThrow("repeated");
});

test("stops when polling returns no more entries even if the cursor is retained", async () => {
  expect(await readBuildLogs(account, build, "token", () => {}, pages(
    { lines: [[1, "build failed"]], cursor: "end" }, { lines: [], cursor: "end" }))).toBe(1);
});

const mainCommit = "a".repeat(40);
const failedBuild = {
  status: "stopped", build_outcome: "fail",
  build_trigger_metadata: { branch: "main", commit_hash: mainCommit, provider_account_name: "worldcoin", repo_name: "web-authenticator" },
  trigger: { external_script_id: "staging-tag", trigger_uuid: build },
};
const workers = [{ id: "web-authenticator-dev", tag: "staging-tag" }];

test("retry rejects production, old commits, other repositories, and running builds", () => {
  expect(stagingRetryTarget(failedBuild, workers, mainCommit)).toBe(build);
  expect(() => stagingRetryTarget(failedBuild, [{ id: "web-authenticator-prod", tag: "staging-tag" }], mainCommit)).toThrow();
  expect(() => stagingRetryTarget(failedBuild, workers, "b".repeat(40))).toThrow();
  expect(() => stagingRetryTarget({ ...failedBuild, status: "running" }, workers, mainCommit)).toThrow();
  expect(() => stagingRetryTarget({ ...failedBuild, build_trigger_metadata: { ...failedBuild.build_trigger_metadata, repo_name: "other" } }, workers, mainCommit)).toThrow();
});

test("retry submits the verified main SHA once and propagates an uncertain POST failure", async () => {
  let posts = 0;
  const request = async (url: URL, init: RequestInit) => {
    if (url.pathname.endsWith("/workers/scripts")) return Response.json({ success: true, result: workers });
    if (init.method === "GET") return Response.json({ success: true, result: failedBuild });
    posts++;
    expect(JSON.parse(init.body as string)).toEqual({ branch: "main", commit_hash: mainCommit });
    throw new Error("network timeout");
  };
  await expect(retryStagingBuild(account, build, "token", mainCommit, request)).rejects.toThrow("network timeout");
  expect(posts).toBe(1);
});
