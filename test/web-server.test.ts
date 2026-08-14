import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveStaticAssetPath } from "../src/adapters/web-server.js";

test("static UI resolution serves only real files inside the built UI root", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "icon-svg-select-web-"));
  const outside = await mkdtemp(join(tmpdir(), "icon-svg-select-outside-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  });

  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html>");
  await writeFile(join(root, "assets", "app.js"), "export {};");
  await writeFile(join(outside, "secret.txt"), "not public");
  await symlink(join(outside, "secret.txt"), join(root, "assets", "escape.txt"));

  assert.equal(await resolveStaticAssetPath(root, "/"), await realpath(join(root, "index.html")));
  assert.equal(await resolveStaticAssetPath(root, "/assets/app.js"), await realpath(join(root, "assets", "app.js")));
  assert.equal(await resolveStaticAssetPath(root, "/../secret.txt"), null);
  assert.equal(await resolveStaticAssetPath(root, "/%2e%2e/secret.txt"), null);
  assert.equal(await resolveStaticAssetPath(root, "/assets/escape.txt"), null);
  assert.equal(await resolveStaticAssetPath(root, "/missing.js"), null);
});
