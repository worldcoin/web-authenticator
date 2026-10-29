import { expect, test } from "bun:test";
import { CONSENT_KEY, createConsentClient } from "../lib/consent";

const DAY_MS = 24 * 60 * 60 * 1000;

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) } as Storage,
  };
}

test("consent is unset by default and denied under Global Privacy Control", async () => {
  const { storage } = memoryStorage();
  expect(await createConsentClient(() => storage, () => false).read()).toBe("unset");
  expect(await createConsentClient(() => storage, () => true).read()).toBe("denied");
});

test("a saved choice holds only the choice, version and time, and is read back over GPC", async () => {
  const { items, storage } = memoryStorage();
  const client = createConsentClient(() => storage, () => true, () => 1_000);
  expect(await client.save("granted")).toBe("granted");
  expect(JSON.parse(items.get(CONSENT_KEY)!)).toEqual({ choice: "granted", version: "v1", at: 1_000 });
  expect(await client.read()).toBe("granted");
});

test("old versions, expired, malformed or unknown values read as unset", async () => {
  const now = 200 * DAY_MS;
  const read = (value: string) => createConsentClient(() => memoryStorage({ [CONSENT_KEY]: value }).storage, () => false, () => now).read();
  expect(await read(JSON.stringify({ choice: "granted", version: "v0", at: now }))).toBe("unset");
  expect(await read(JSON.stringify({ choice: "granted", version: "v1", at: now - 181 * DAY_MS }))).toBe("unset");
  expect(await read(JSON.stringify({ choice: "yes", version: "v1", at: now }))).toBe("unset");
  expect(await read("{")).toBe("unset");
  expect(await read("null")).toBe("unset");
  expect(await read(JSON.stringify({ choice: "denied", version: "v1", at: now - 179 * DAY_MS }))).toBe("denied");
});

test("blocked storage rejects so the app can ask again or show a save error", async () => {
  const blocked = () => { throw new DOMException("blocked", "SecurityError"); };
  const client = createConsentClient(blocked, () => false);
  await expect(client.read()).rejects.toThrow("blocked");
  await expect(client.save("denied")).rejects.toThrow("blocked");
});
