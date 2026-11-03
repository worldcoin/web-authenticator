import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAccessVerifier } from "../lib/cloudflare-access";
import { COMPRESSED_WASM_PREFIX, serveWorkerAsset } from "../lib/cloudflare-assets";
import { createWorkerHandler } from "../worker";
import { packageCloudflareAssets } from "../../scripts/build-cloudflare";
import { AUTHENTICATOR_APP_SECURITY_HEADERS_V0 } from "../lib/config";

const origin = "https://authenticator.example";
const request = (path = "/", init?: RequestInit) => new Request(origin + path, init);
const environment = (fetchAsset: (request: Request) => Promise<Response>): Env => ({
  CF_ACCESS_TEAM_DOMAIN: "tfh-test.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-audience",
  ASSETS: { fetch: fetchAsset } as Fetcher,
});

test("Access fails closed before configuration and rejects unsigned or invalid tokens", async () => {
  let lookups = 0;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256" };
  const verify = createAccessVerifier(async () => {
    lookups++;
    return Response.json({ keys: [jwk] });
  });
  const env = environment(async () => new Response("private"));
  expect((await verify(request(), { ...env, CF_ACCESS_AUD: "" }))?.status).toBe(503);
  expect((await verify(request(), env))?.status).toBe(403);
  expect(lookups).toBe(0);
  const sign = (audience = env.CF_ACCESS_AUD, issuer = `https://${env.CF_ACCESS_TEAM_DOMAIN}`, expires = "1h") =>
    new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("test-user").setIssuer(issuer).setAudience(audience).setIssuedAt()
      .setExpirationTime(expires).sign(privateKey);
  const authenticated = (token: string) => request("/", { headers: { "cf-access-jwt-assertion": token } });
  expect(await verify(authenticated(await sign()), env)).toBeUndefined();
  for (const token of [await sign("another-app"), await sign(undefined, "https://untrusted.example"), await sign(undefined, undefined, "-1h"), "forged.jwt.value"]) {
    expect((await verify(authenticated(token), env))?.status).toBe(403);
  }
  expect(lookups).toBe(1);
});

test("Worker protects every route and asset before reaching storage", async () => {
  let reads = 0;
  const env = environment(async () => { reads++; return new Response("private"); });
  const handle = createWorkerHandler();
  for (const path of ["/", "/verify?k=secret", "/api/health/live", "/assets/walletkit.wasm", "/_cf/wasm/assets/walletkit.wasm.gz"]) {
    const response = await handle(request(path), env);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(reads).toBe(0);
});

test("Worker preserves verify URLs, API methods and security headers", async () => {
  const paths: string[] = [];
  const env = environment(async req => {
    paths.push(req.url);
    return new Response("<h1>Authenticator</h1>", { headers: { "Content-Type": "text/html" } });
  });
  const handle = createWorkerHandler(async () => undefined);
  const page = await handle(request("/verify?k=bridge-secret"), env);
  expect(page.status).toBe(200);
  expect(page.headers.get("location")).toBeNull();
  expect(await page.text()).toContain("Authenticator");
  expect(paths).toEqual([origin + "/index.html"]);
  for (const [name, value] of Object.entries(AUTHENTICATOR_APP_SECURITY_HEADERS_V0)) expect(page.headers.get(name)).toBe(value);
  expect((await handle(request("/api/health/ready"), env)).status).toBe(200);
  expect((await handle(request("/api/staging-rp?id=bad"), env)).status).toBe(400);
  expect((await handle(request("/api/health/live", { method: "POST" }), env)).status).toBe(404);
  expect((await handle(request("/api/unknown"), env)).status).toBe(404);
  expect((await handle(request("/api/consent"), env)).status).toBe(404);
  const head = await handle(request("/verify", { method: "HEAD" }), env);
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  paths.length = 0;
  expect((await handle(request("/authenticator"), env)).status).toBe(200);
  expect((await handle(request("/authenticator/deep/link"), env)).status).toBe(200);
  expect(paths).toEqual([origin + "/index.html", origin + "/index.html"]);
  paths.length = 0;
  await handle(request("/assets/missing.js"), env);
  expect(paths).toEqual([origin + "/assets/missing.js"]);
});

test("large WASM uploads as one gzip file and decodes byte-for-byte at its original URL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "authenticator-cloudflare-"));
  try {
    const source = join(directory, "source");
    const output = join(directory, "output");
    await mkdir(join(source, "assets"), { recursive: true });
    const bytes = new Uint8Array(25 * 1024 * 1024 + 1);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
    await writeFile(join(source, "assets/walletkit.wasm"), bytes);
    await writeFile(join(source, "assets/small.wasm"), new Uint8Array([0, 97, 115, 109]));
    await writeFile(join(source, "index.html"), "app");
    expect(await packageCloudflareAssets(source, output)).toBe(1);
    const compressedPath = `${COMPRESSED_WASM_PREFIX}/assets/walletkit.wasm.gz`;
    const compressedFile = Bun.file(join(output, compressedPath));
    expect(compressedFile.size).toBeLessThanOrEqual(25 * 1024 * 1024);
    expect(await Bun.file(join(output, "assets/walletkit.wasm")).exists()).toBe(false);
    expect(await Bun.file(join(source, "assets/walletkit.wasm")).exists()).toBe(true);
    const env = environment(async req => {
      expect(new URL(req.url).search).toBe("");
      expect(req.headers.get("cookie")).toBeNull();
      expect(req.headers.get("range")).toBeNull();
      const file = Bun.file(join(output, new URL(req.url).pathname));
      return await file.exists() ? new Response(file) : new Response("missing", { status: 404 });
    });
    const response = await serveWorkerAsset(request("/assets/walletkit.wasm?k=secret", {
      headers: { "Accept-Encoding": "br, gzip", Cookie: "private=session", Range: "bytes=0-100" },
    }), env.ASSETS);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    const expectedHash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const decoded = gunzipSync(await response.arrayBuffer());
    expect(decoded.byteLength).toBe(bytes.length);
    expect(new Bun.CryptoHasher("sha256").update(decoded).digest("hex")).toBe(expectedHash);
    expect((await serveWorkerAsset(request(compressedPath), env.ASSETS)).status).toBe(404);
    const small = await serveWorkerAsset(request("/assets/small.wasm"), env.ASSETS);
    expect(small.headers.get("content-encoding")).toBeNull();
    expect(new Uint8Array(await small.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
    for (const encoding of ["identity", "gzip;q=0, *;q=1", ""]) {
      const plain = await serveWorkerAsset(request("/assets/walletkit.wasm", { headers: { "Accept-Encoding": encoding } }), env.ASSETS);
      expect(plain.headers.get("content-encoding")).toBeNull();
      expect(new Bun.CryptoHasher("sha256").update(await plain.arrayBuffer()).digest("hex")).toBe(expectedHash);
    }
    expect((await serveWorkerAsset(request("/assets/walletkit.wasm", { headers: { "Accept-Encoding": "gzip;q=0, identity;q=0" } }), env.ASSETS)).status).toBe(406);
    const head = await serveWorkerAsset(request("/assets/walletkit.wasm", { method: "HEAD", headers: { "Accept-Encoding": "gzip" } }), env.ASSETS);
    expect(head.headers.get("content-encoding")).toBe("gzip");
    expect(await head.text()).toBe("");
    await rm(join(output, compressedPath));
    expect((await serveWorkerAsset(request("/assets/walletkit.wasm"), env.ASSETS)).status).toBe(404);
    expect((await serveWorkerAsset(request("/assets/missing.wasm"), env.ASSETS)).status).toBe(404);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("packaging rejects WASM that still exceeds the upload limit after compression", async () => {
  const directory = await mkdtemp(join(tmpdir(), "authenticator-compression-limit-"));
  try {
    const source = join(directory, "source");
    await mkdir(source);
    const bytes = new Uint8Array(25 * 1024 * 1024 + 1);
    for (let offset = 0; offset < bytes.length; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, offset + 65536));
    await writeFile(join(source, "large.wasm"), bytes);
    await expect(packageCloudflareAssets(source, join(directory, "output"))).rejects.toThrow("Compressed WASM exceeds 25 MiB");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WASM encoding negotiation accepts whitespace before quality weights", async () => {
  const bytes = new Uint8Array([0, 97, 115, 109]);
  const compressed = gzipSync(bytes);
  const env = environment(async req => new URL(req.url).pathname.endsWith(".gz")
    ? new Response(compressed) : new Response("missing", { status: 404 }));
  for (const [encoding, status, gzip] of [
    ["gzip ; q=1, identity;q=0", 200, true],
    ["gzip\t; q=1, identity ; q=0", 200, true],
    ["gzip ; q=0, identity ; q=0", 406, false],
    ["gzip ; q=0, * ; q=1", 200, false],
    ["br, * \t; q=1, identity;q=0", 200, true],
  ] as const) {
    const response = await serveWorkerAsset(request("/assets/walletkit.wasm", {
      headers: { "Accept-Encoding": encoding },
    }), env.ASSETS);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-encoding")).toBe(gzip ? "gzip" : null);
    if (status === 200) {
      const body = await response.arrayBuffer();
      expect(new Uint8Array(gzip ? gunzipSync(body) : body)).toEqual(bytes);
    }
  }
});
