import type { ProtocolEnvironment } from "./environment";

/** Where the build put the gzipped WalletKit WASM, and what it must decompress to. */
export type WalletKitWasm = { url: string; byteLength: number; sha256: string };

/** Path of the file that identifies a deployed build. */
export const RELEASE_FILE = "release.json";
export type ReleaseManifest = { environment: ProtocolEnvironment; commit: string | null };
