import { describe, expect, test } from "bun:test";
import { SimulationArtifactInProductionError } from "../../../packages/contracts/src";
import { GatewayErrorV0, rejectSimulationArtifactAtProductionBoundary } from "../src";
import { CONTEXT, createBody, makeHarness } from "./helpers";

describe("production isolation", () => {
  test("makes every gateway route unavailable in production", async () => {
    const harness = await makeHarness({ runtimeEnvironment: "production" });
    try {
      await harness.gateway.createSession(createBody(), CONTEXT);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayErrorV0);
      expect((error as GatewayErrorV0).code).toBe("gateway_disabled");
    }
    expect(await harness.gateway.readiness()).toEqual({ ready: false, code: "disabled" });
  });

  test("rejects a production route before inspecting its body", async () => {
    const harness = await makeHarness({ runtimeEnvironment: "production" });
    const body = new Proxy({}, { ownKeys() { throw new Error("body inspected"); } });
    try {
      await harness.gateway.createSession(body, CONTEXT);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayErrorV0);
      expect((error as GatewayErrorV0).code).toBe("gateway_disabled");
    }
  });

  test.each([
    ["receipt", { kind: "simulation_receipt_v0" }],
    ["credential", { kind: "simulated_staging_credential_v0" }],
    ["mode", { mode: "simulation" }],
    ["environment", { environment: "staging" }],
  ] as const)("rejects simulation by %s discriminator before sensitive getters", (_label, discriminator) => {
    const touched: string[] = [];
    const artifact = Object.defineProperties({ ...discriminator }, {
      outcome: { enumerable: false, get() { touched.push("outcome"); throw new Error("outcome read"); } },
      authentication: { enumerable: false, get() { touched.push("authentication"); throw new Error("authentication read"); } },
    });
    expect(() => rejectSimulationArtifactAtProductionBoundary("production", artifact)).toThrow(SimulationArtifactInProductionError);
    expect(touched).toEqual([]);
  });
});
