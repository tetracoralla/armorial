import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { isMainModule } from "../src/adapters/main-module.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("main-module detection resolves URL encoding and package-bin symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "icon svg select entry-"));
  const target = resolve(workspace, "src/adapters/cli.ts");
  const entry = join(directory, "icon svg select");

  try {
    await symlink(target, entry, "file");
    assert.equal(isMainModule(pathToFileURL(target).href, entry), true);
    assert.equal(isMainModule(pathToFileURL(target).href, undefined), false);
  } finally {
    await rm(directory, { recursive: true });
  }
});
