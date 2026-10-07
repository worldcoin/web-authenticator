import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const deviceRoot = resolve(import.meta.dir, "../device-lab");

describe("physical-device evidence package", () => {
  test("ships a strict observation schema without payload-bearing fields", () => {
    const schema = JSON.parse(readFileSync(
      resolve(deviceRoot, "observation.schema.json"),
      "utf8",
    )) as {
      readonly additionalProperties: boolean;
      readonly required: readonly string[];
      readonly properties: Readonly<Record<string, unknown>>;
    };
    expect(schema.additionalProperties).toBe(false);
    for (const field of [
      "productRevision",
      "device",
      "browser",
      "provider",
      "sensitiveOperationCounts",
      "capture",
      "performance",
      "accessibility",
      "sanitizationConfirmed",
    ]) expect(schema.required).toContain(field);
    for (const forbidden of [
      "image",
      "video",
      "rawMedia",
      "passkey",
      "privateKey",
      "credential",
      "signature",
      "bearerToken",
    ]) expect(Object.keys(schema.properties)).not.toContain(forbidden);
  });

  test("names every required physical OS/browser cell as unexecuted", () => {
    const report = readFileSync(resolve(deviceRoot, "UNEXECUTED.md"), "utf8");
    for (const os of ["iOS 15", "iOS 16", "iOS 17", "iOS 18", "Current production iOS"]) {
      expect(report).toContain(os);
    }
    expect(report.match(/Unexecuted:/g)).toHaveLength(10);
    expect(report).toContain("desktop WebKit results must not be relabeled");
  });
});
