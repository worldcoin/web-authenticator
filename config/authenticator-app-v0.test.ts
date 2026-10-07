import { describe, expect, test } from "bun:test";
import {
  SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
  SIMULATOR_UI_QUALITY_POLICY_V0,
} from "../packages/contracts/src";
import {
  AUTHENTICATOR_APP_CONFIG,
  AUTHENTICATOR_APP_SECURITY_HEADERS_V0,
  AUTHENTICATOR_RP_PRESENTATIONS_V0,
} from "./authenticator-app-v0";

describe("Main-owned authenticator app configuration", () => {
  test("is staging-only, server-scenario-owned, metadata-only, and runtime frozen", () => {
    expect(AUTHENTICATOR_APP_CONFIG.runtimeEnvironment).toBe("staging");
    expect(AUTHENTICATOR_APP_CONFIG.gatewayEnabled).toBe(true);
    expect(AUTHENTICATOR_APP_CONFIG.localWalkthroughOrigin).toBe(
      "http://localhost:4173",
    );
    expect(AUTHENTICATOR_APP_CONFIG.defaultBiometricScenario).toBe("happy_path");
    expect(AUTHENTICATOR_APP_CONFIG.defaultIssuanceScenario).toBe("issue_success");
    expect(AUTHENTICATOR_APP_CONFIG.capturePolicy).toBe(
      SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
    );
    expect(AUTHENTICATOR_APP_CONFIG.qualityPolicy).toBe(
      SIMULATOR_UI_QUALITY_POLICY_V0,
    );
    expect(AUTHENTICATOR_APP_CONFIG.capturePolicy.dataMode).toBe("metadata_only");
    expect(AUTHENTICATOR_APP_CONFIG.qualityPolicy.checks).toEqual([
      { kind: "camera_active" },
    ]);
    expect(AUTHENTICATOR_APP_CONFIG.biometricSimulatorVersion).toBe(
      "cs5-simulated-biometric-v0",
    );
    expect(AUTHENTICATOR_APP_CONFIG.biometricReceiptTtlMs).toBe(60_000);
    expect(AUTHENTICATOR_APP_CONFIG.stagingCredentialTtlMs).toBe(60_000);
    expect(AUTHENTICATOR_APP_CONFIG.demoCompletionTtlMs).toBe(60_000);
    expect(AUTHENTICATOR_APP_CONFIG.biometricCacheEntries).toBe(1_024);
    expect(AUTHENTICATOR_APP_CONFIG.issuanceCacheEntries).toBe(1_024);
    expect(new Set(Object.values(AUTHENTICATOR_APP_CONFIG.purposeKeyIds)).size).toBe(5);
    expect(Object.isFrozen(AUTHENTICATOR_APP_CONFIG.purposeKeyIds)).toBe(true);
    expect(Object.isFrozen(AUTHENTICATOR_APP_CONFIG)).toBe(true);
    expect(Object.isFrozen(AUTHENTICATOR_APP_CONFIG.allowedSyntheticFixtureIds)).toBe(true);
  });

  test("binds to loopback 4173 by default and derives rpId from the public origin", () => {
    expect(AUTHENTICATOR_APP_CONFIG.host).toBe("127.0.0.1");
    expect(AUTHENTICATOR_APP_CONFIG.port).toBe(4173);
    expect(AUTHENTICATOR_APP_CONFIG.publicOrigin).toBe("http://127.0.0.1:4173");
    expect(AUTHENTICATOR_APP_CONFIG.rpId).toBe("127.0.0.1");
  });

  test("takes binding and exact origins from the environment and rejects non-origins", () => {
    const configPath = new URL("./authenticator-app-v0.ts", import.meta.url).pathname;
    const script = `import { AUTHENTICATOR_APP_CONFIG as c } from ${JSON.stringify(configPath)};` +
      "process.stdout.write(JSON.stringify({ host: c.host, port: c.port, publicOrigin: c.publicOrigin, " +
      "localWalkthroughOrigin: c.localWalkthroughOrigin, rpId: c.rpId }));";
    const ok = Bun.spawnSync(["bun", "-e", script], {
      env: {
        ...process.env,
        AUTHENTICATOR_HOST: "0.0.0.0",
        PORT: "8080",
        AUTHENTICATOR_PUBLIC_ORIGIN: "https://verify.example.com/",
        AUTHENTICATOR_LOCAL_ORIGIN: "",
      },
    });
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(ok.stdout.toString())).toEqual({
      host: "0.0.0.0",
      port: 8080,
      publicOrigin: "https://verify.example.com",
      localWalkthroughOrigin: "http://localhost:8080",
      rpId: "verify.example.com",
    });

    for (const bad of ["https://verify.example.com/path", "verify.example.com", "ftp://x.example"]) {
      const rejected = Bun.spawnSync(["bun", "-e", script], {
        env: { ...process.env, AUTHENTICATOR_PUBLIC_ORIGIN: bad },
      });
      expect(rejected.exitCode, bad).not.toBe(0);
      expect(rejected.stderr.toString(), bad).toContain("AUTHENTICATOR_PUBLIC_ORIGIN");
    }
    const badPort = Bun.spawnSync(["bun", "-e", script], { env: { ...process.env, PORT: "99999" } });
    expect(badPort.exitCode).not.toBe(0);
  });

  test("uses allowlisted RP presentation and a same-origin server-managed return", () => {
    expect(Object.keys(AUTHENTICATOR_RP_PRESENTATIONS_V0)).toEqual(["zoom_demo"]);
    expect(AUTHENTICATOR_RP_PRESENTATIONS_V0.zoom_demo).toEqual({
      displayName: "Zoom",
      iconAssetId: "zoom",
      returnLabel: "Return to Zoom",
      returnPath: "/returned",
    });
    expect(Object.isFrozen(AUTHENTICATOR_RP_PRESENTATIONS_V0)).toBe(true);
    expect(Object.isFrozen(AUTHENTICATOR_RP_PRESENTATIONS_V0.zoom_demo)).toBe(true);
  });

  test("freezes restrictive browser security headers", () => {
    expect(AUTHENTICATOR_APP_SECURITY_HEADERS_V0["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(AUTHENTICATOR_APP_SECURITY_HEADERS_V0["Content-Security-Policy"]).toContain(
      "connect-src 'self'",
    );
    expect(AUTHENTICATOR_APP_SECURITY_HEADERS_V0["Content-Security-Policy"]).toContain(
      "script-src 'self' 'wasm-unsafe-eval'",
    );
    expect(AUTHENTICATOR_APP_SECURITY_HEADERS_V0["Content-Security-Policy"])
      .not.toContain("'unsafe-eval'");
    expect(AUTHENTICATOR_APP_SECURITY_HEADERS_V0["Permissions-Policy"]).toBe(
      "camera=(self), microphone=(), geolocation=()",
    );
    expect(AUTHENTICATOR_APP_SECURITY_HEADERS_V0["Cache-Control"]).toBe("no-store");
    expect(Object.isFrozen(AUTHENTICATOR_APP_SECURITY_HEADERS_V0)).toBe(true);
  });
});
