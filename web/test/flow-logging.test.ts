import { expect, spyOn, test } from "bun:test";
import { logFlowStep } from "../lib/flow-logging";

test("flow diagnostics expose known SDK codes without dependency payloads", async () => {
  const info = spyOn(console, "info").mockImplementation(() => {});
  const errorLog = spyOn(console, "error").mockImplementation(() => {});
  try {
    const error = Object.assign(new Error("private dependency payload"), { name: "WalletKitError", code: "AccountDoesNotExist", detail: "private detail" });
    await expect(logFlowStep("test.initialize", async () => { throw error; })).rejects.toBe(error);
    expect(errorLog.mock.calls[0]?.[1]).toMatchObject({ category: "WalletKitError", code: "AccountDoesNotExist" });
    const unknown = Object.assign(new Error("private dependency payload"), { name: "PrivateName", code: "private-code" });
    await expect(logFlowStep("test.initialize", async () => { throw unknown; })).rejects.toBe(unknown);
    expect(errorLog.mock.calls[1]?.[1]).toMatchObject({ category: "OperationError" });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private");
    expect(errorLog.mock.calls[1]?.[1]).not.toHaveProperty("code");
  } finally { info.mockRestore(); errorLog.mockRestore(); }
});
