import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { AUTHENTICATOR_APP_CONFIG } from "@clean-start/app-config";
import { createAuthenticatorHttpHandlerV0 } from "../../../apps/authenticator/src/server/http.server";
import { createAuthenticatorServerRuntimeV0 } from "../../../apps/authenticator/src/server/runtime.server";
import { completeScenario } from "../testkit/runtime";

const cleanStartRoot = resolve(import.meta.dir, "../../..");

function filesUnder(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(path));
    else result.push(path);
  }
  return result;
}

function sourceText(paths: readonly string[]): string {
  return paths.map((path) => `\n/* ${relative(cleanStartRoot, path)} */\n${readFileSync(path, "utf8")}`).join("");
}

function apiRequest(path: string, body: unknown): Request {
  return new Request(`${AUTHENTICATOR_APP_CONFIG.publicOrigin}${path}`, {
    method: "POST",
    headers: {
      origin: AUTHENTICATOR_APP_CONFIG.publicOrigin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("privacy, isolation, and copy sentinels", () => {
  test("client source contains no browser persistence, beacon, cookie, or server imports", () => {
    const clientRoot = join(cleanStartRoot, "apps/authenticator/src");
    const clientFiles = filesUnder(clientRoot).filter((path) =>
      [".ts", ".tsx"].includes(extname(path)) && !path.includes(`${join("src", "server")}/`));
    const text = sourceText(clientFiles);
    const nonWalletText = sourceText(clientFiles.filter(path => !path.endsWith("/wallet/session.ts")));
    expect(nonWalletText).not.toMatch(/\blocalStorage\b/);
    for (const forbidden of [
      /\bsessionStorage\b/,
      /\bindexedDB\b/,
      /\bdocument\.cookie\b/,
      /\bsendBeacon\b/,
      /from\s+["'][^"']*\/services\//,
      /from\s+["'][^"']*\/server\//,
      /from\s+["']@clean-start\/(?:session-gateway|simulated-biometric-verifier|simulated-staging-issuer)/,
    ]) expect(text).not.toMatch(forbidden);
  });

  test("clean-start product source has no S1 implementation import", () => {
    const productFiles = filesUnder(cleanStartRoot).filter((path) =>
      [".ts", ".tsx", ".js", ".mjs", ".css", ".html"].includes(extname(path)) &&
      !path.includes("node_modules") &&
      !path.includes("dist"));
    const text = sourceText(productFiles);
    expect(text).not.toMatch(/(?:from|import\s*\()\s*["'][^"']*(?:\/s1\/|legacy|src-old)/i);
  });

  test("actual browser projections omit secrets, raw media, signatures, and detailed measurements", async () => {
    const completed = await completeScenario("happy_path", "issue_success", "privacy-projection");
    const serialized = JSON.stringify({
      bootstrap: completed.bootstrap,
      created: completed.created,
      captureReady: completed.captureReady,
      result: completed.result,
    });
    for (const forbidden of [
      "privateKey",
      "derivedKey",
      "prfResult",
      "signatureBase64Url",
      "receiptId",
      "credentialId",
      "embedding",
      "landmarks",
      "pixels",
      "mediaStream",
      "deviceId",
      "deviceLabel",
      "biometricScenario",
      "issuanceScenario",
    ]) expect(serialized).not.toContain(forbidden);
    expect(completed.submitInput.frameBundle.dataMode).toBe("metadata_only");
    expect(Object.keys(completed.submitInput.frameBundle.frames[0] ?? {})).toEqual([
      "transportIndex",
      "width",
      "height",
      "encoding",
      "byteLength",
      "frameDigestSha256",
    ]);
  });

  test("invalid canaries are rejected without reflection into errors or headers", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const handle = createAuthenticatorHttpHandlerV0(runtime.browserPort);
    const canaries = {
      privateKey: "W09_PRIVATE_KEY_CANARY",
      rawFrame: "data:image/png;base64,W09_RAW_MEDIA_CANARY",
      upstreamError: "W09_UPSTREAM_FREE_TEXT_CANARY",
      signatureBase64Url: "W09_SIGNATURE_CANARY",
    };
    const response = await handle(apiRequest("/api/v0/session/create", {
      idempotencyKey: "privacy-canary",
      ...canaries,
    }));
    expect(response.status).toBe(400);
    const observed = `${JSON.stringify(await response.json())}\n${JSON.stringify(Object.fromEntries(response.headers))}`;
    for (const value of Object.values(canaries)) expect(observed).not.toContain(value);
  });

  test("committed fixtures and reports contain no real biometric or credential payload files", () => {
    const integrationRoot = resolve(import.meta.dir, "..");
    const files = filesUnder(integrationRoot);
    for (const path of files) {
      expect([".mp4", ".mov", ".webm", ".heic", ".jpg", ".jpeg"], path)
        .not.toContain(extname(path).toLowerCase());
    }
    const textFiles = files.filter((path) => [".ts", ".md", ".json"].includes(extname(path)));
    const text = sourceText(textFiles);
    expect(text).not.toContain(["BEGIN", "PRIVATE KEY"].join(" "));
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]{12,}/);
  });

  test("user-visible copy never presents simulation as real biometric, TEE, uniqueness, or issuance proof", () => {
    const copy = readFileSync(
      join(cleanStartRoot, "packages/contracts/src/authenticator-ui-copy-v1.ts"),
      "utf8",
    );
    expect(copy).toContain("Staging demo");
    expect(copy).toContain("No biometric verification or uniqueness check was performed");
    expect(copy).toContain("not a Selfie Check credential");
    expect(copy).not.toMatch(/(?:verified|proven)\s+(?:real person|camera provenance|TEE)/i);
  });
});
