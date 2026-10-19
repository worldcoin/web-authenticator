import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "vite";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

for (const mode of ["static", "dynamic", "worker"] as const) {
  test(`browser build rejects API code through a ${mode} import`, async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "authenticator-boundary-"));
    temporaryDirectories.push(directory);
    const entry = resolve(directory, "entry.js");
    const apiConfig = resolve(import.meta.dir, "../../api/lib/config.ts");
    if (mode === "worker") {
      await writeFile(resolve(directory, "worker.js"), `import ${JSON.stringify(apiConfig)};`);
      await writeFile(entry, 'new Worker(new URL("./worker.js", import.meta.url), { type: "module" });');
    } else {
      await writeFile(entry, mode === "static"
        ? `import ${JSON.stringify(apiConfig)};`
        : `import(${JSON.stringify(apiConfig)});`);
    }
    await expect(build({
      configFile: resolve(import.meta.dir, "../vite.config.ts"),
      publicDir: false,
      logLevel: "silent",
      build: { write: false, rollupOptions: { input: entry } },
    })).rejects.toThrow("Browser builds cannot import API, experiment, or test modules");
  });
}
