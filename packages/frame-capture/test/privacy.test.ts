import { afterEach, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MetadataOnlyCaptureRuntime } from "../src";
import { FakePlatform, makeRequest, testFrame } from "./helpers";

const replacedDescriptors = new Map<string, PropertyDescriptor | undefined>();

function installSentinel(name: string, value: unknown): void {
  replacedDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

afterEach(() => {
  for (const [name, descriptor] of replacedDescriptors) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, descriptor);
  }
  replacedDescriptors.clear();
});

describe("camera-byte privacy boundary", () => {
  test("touches no network or persistent-storage API during capture", async () => {
    const touched: string[] = [];
    installSentinel("fetch", () => touched.push("fetch"));
    installSentinel("XMLHttpRequest", class {
      constructor() {
        touched.push("XMLHttpRequest");
      }
    });
    installSentinel("WebSocket", class {
      constructor() {
        touched.push("WebSocket");
      }
    });
    installSentinel("navigator", {
      ...navigator,
      sendBeacon: () => {
        touched.push("sendBeacon");
        return true;
      },
    });
    installSentinel("caches", {
      open: () => {
        touched.push("caches.open");
        return Promise.resolve(undefined);
      },
    });
    for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
      replacedDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => {
          touched.push(name);
          return undefined;
        },
      });
    }

    const platform = new FakePlatform();
    const frame = testFrame([211, 173, 199, 241]);
    platform.sampler.frames.push(frame);
    const artifact = await new MetadataOnlyCaptureRuntime(platform).capture(makeRequest());

    expect(touched).toEqual([]);
    expect(frame.bytes).toEqual(new Uint8ClampedArray(4));
    expect(JSON.stringify(artifact)).not.toContain("211,173,199,241");
    expect(Object.values(artifact.frames[0] ?? {}).some(ArrayBuffer.isView)).toBe(false);
  });

  test("runtime source contains no media recorder, upload, storage, URL, or logging path", async () => {
    const sourceDirectory = join(import.meta.dir, "../src");
    const files = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts"));
    const source = (
      await Promise.all(files.map((name) => readFile(join(sourceDirectory, name), "utf8")))
    ).join("\n");
    const forbidden = [
      "MediaRecorder",
      "Blob",
      "FileReader",
      "XMLHttpRequest",
      "WebSocket",
      "sendBeacon",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "caches.open",
      "toDataURL",
      "toBlob",
      "createObjectURL",
      "console.",
    ];
    for (const token of forbidden) expect(source).not.toContain(token);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  test("safe errors do not copy arbitrary camera error fields", async () => {
    const platform = new FakePlatform();
    platform.requestResult = Promise.reject({
      name: "NotReadableError",
      pixels: [211, 173, 199, 241],
      dataUrl: "data:image/private",
    });
    try {
      await new MetadataOnlyCaptureRuntime(platform).capture(makeRequest());
      throw new Error("expected rejection");
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("211");
      expect(String(error)).not.toContain("data:image");
    }
  });
});
