import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { KERNEL_VERSION } from "../src/core/contracts.js";

test("public package, runtime, lockfile, and Codex plugin share one version", async () => {
  const [packageSource, lockSource, pluginSource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource) as { name?: unknown; version?: unknown };
  const packageLock = JSON.parse(lockSource) as {
    name?: unknown;
    version?: unknown;
    packages?: Record<string, { name?: unknown; version?: unknown }>;
  };
  const pluginJson = JSON.parse(pluginSource) as { version?: unknown };

  assert.match(KERNEL_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.version, KERNEL_VERSION);
  assert.equal(packageLock.version, KERNEL_VERSION);
  assert.equal(packageLock.packages?.[""]?.version, KERNEL_VERSION);
  assert.equal(pluginJson.version, KERNEL_VERSION);
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.packages?.[""]?.name, packageJson.name);
});

test("license inventory keeps npm pack JSON mode out of its parseable dependency listing", async () => {
  const source = await readFile(
    new URL("../scripts/generate-third-party-notices.mjs", import.meta.url),
    "utf8",
  );

  assert.equal(source.match(/"--json=false"/g)?.length, 2);
  assert.match(source, /"--parseable", "--json=false"/);
});
