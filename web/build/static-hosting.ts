import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

import { RELEASE_FILE, type ReleaseManifest, type WalletKitWasm } from "../../config/build-manifest";
import type { ProtocolEnvironment } from "../../config/environment";
import { renderHeadersFile, securityHeaders } from "../../config/security-headers";

/** Cloudflare Workers static assets reject larger files. */
const ASSET_SIZE_LIMIT = 25 * 1024 * 1024;

/**
 * WalletKit's WASM is larger than one Cloudflare asset may be, so the build ships it gzipped
 * and tells the browser what the decompressed file must be (web/lib/walletkit-wasm.ts).
 */
export function compressedWalletKitWasm(wasmPath: string): Plugin {
  const wasm = readFileSync(wasmPath);
  const sha256 = createHash("sha256").update(wasm).digest("hex");
  // ".bin" makes every static server send the bytes untouched as application/octet-stream. A ".gz"
  // name is answered by some with Content-Encoding: gzip, which the browser would already undo.
  const fileName = `assets/walletkit-${sha256.slice(0, 16)}.wasm.gzip.bin`;
  const manifest: WalletKitWasm = { url: `/${fileName}`, byteLength: wasm.byteLength, sha256 };
  let compressed: Buffer | undefined;
  const compress = () => compressed ??= gzipSync(wasm, { level: 9 });
  return {
    name: "compressed-walletkit-wasm",
    config: () => ({ define: { __WALLETKIT_WASM__: JSON.stringify(manifest) } }),
    configureServer(server) {
      server.middlewares.use(manifest.url, (_request, response) => {
        response.setHeader("Content-Type", "application/octet-stream");
        response.end(compress());
      });
    },
    generateBundle(_options, bundle) {
      // The package also references its uncompressed WASM, which the app never requests.
      for (const name of Object.keys(bundle)) if (/(^|\/)walletkit-[^/]*\.wasm$/.test(name)) delete bundle[name];
      this.emitFile({ type: "asset", fileName, source: compress() });
    },
  };
}

/** Emits what Cloudflare needs beside the bundle, and serves previews with the same headers. */
export function cloudflareStaticHosting(environment: ProtocolEnvironment, commit: string | undefined): Plugin {
  return {
    name: "cloudflare-static-hosting",
    config: () => ({ preview: { headers: { ...securityHeaders(environment) } } }),
    generateBundle(_options, bundle) {
      const release: ReleaseManifest = { environment, commit: commit ?? null };
      this.emitFile({ type: "asset", fileName: "_headers", source: renderHeadersFile(environment) });
      this.emitFile({ type: "asset", fileName: RELEASE_FILE, source: JSON.stringify(release) });
      for (const [name, file] of Object.entries(bundle)) {
        const size = file.type === "asset" ? Buffer.byteLength(file.source) : Buffer.byteLength(file.code);
        if (size > ASSET_SIZE_LIMIT) this.error(`${name} exceeds Cloudflare's 25 MiB static asset limit.`);
      }
    },
  };
}
