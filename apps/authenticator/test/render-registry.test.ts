import { describe, expect, test } from "bun:test";
import {
  AUTHENTICATOR_UI_COPY_V1,
  AUTHENTICATOR_UI_STATES_V1,
} from "@clean-start/contracts";
import {
  FIGMA_SCREEN_MATRIX_V1,
  SCREEN_RENDER_REGISTRY_V1,
} from "../src/flow/render-registry";
import { FIGMA_ASSET_PROVENANCE_V1 } from "../src/assets/provenance";

describe("authenticator render registry", () => {
  test("has one renderer and frozen copy for every Main-owned UI state", () => {
    expect(Object.keys(SCREEN_RENDER_REGISTRY_V1).sort()).toEqual(
      [...AUTHENTICATOR_UI_STATES_V1].sort(),
    );
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      expect(SCREEN_RENDER_REGISTRY_V1[state]).toBeDefined();
      expect(AUTHENTICATOR_UI_COPY_V1[state].heading.length).toBeGreaterThan(0);
    }
  });

  test("records exact design context for all fifteen nodes and the one unrendered variant", () => {
    expect(FIGMA_SCREEN_MATRIX_V1.verified).toEqual([
      "5132:134352",
      "5132:134394",
      "5132:134441",
      "5132:134488",
      "5132:134535",
      "5132:134582",
      "5132:134643",
      "5132:134692",
      "5132:134743",
      "5132:134841",
      "5132:134939",
      "5132:135038",
      "5132:135071",
      "5132:135104",
      "5132:135141",
    ]);
    expect(FIGMA_SCREEN_MATRIX_V1.notFigmaVerified).toEqual([]);
    expect(FIGMA_SCREEN_MATRIX_V1.verifiedNotRendered).toEqual(["5132:135141"]);
  });

  test("records exact source URLs and checksums for every committed Figma asset", () => {
    expect(FIGMA_ASSET_PROVENANCE_V1).toHaveLength(17);
    for (const asset of FIGMA_ASSET_PROVENANCE_V1) {
      expect(asset.sourceUrl).toMatch(/^https:\/\/www\.figma\.com\/api\/mcp\/asset\//);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.localPath).toMatch(/^\/assets\/figma\//);
    }
    expect(FIGMA_ASSET_PROVENANCE_V1.some((asset) => asset.nodeId === "5132:135038")).toBe(true);
    expect(FIGMA_ASSET_PROVENANCE_V1.some((asset) => asset.nodeId === "5132:135071")).toBe(true);
    expect(FIGMA_ASSET_PROVENANCE_V1.some((asset) => asset.nodeId === "5132:135104")).toBe(true);
  });

  test("matches every provenance checksum to the committed exact bytes", async () => {
    const appRoot = new URL("../", import.meta.url);
    for (const asset of FIGMA_ASSET_PROVENANCE_V1) {
      const bytes = await Bun.file(new URL(`public${asset.localPath}`, appRoot)).arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const actual = Array.from(
        new Uint8Array(digest),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      expect(actual).toBe(asset.sha256);
    }
  });
});
