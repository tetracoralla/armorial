import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeThirdPartyPayload } from "../scripts/third-party-runtime-payload.js";

test("immutable payload analysis preserves only declared Node runtime targets across nested packages", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "armorial-runtime-payload-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const outer = join(root, "node_modules", "outer");
  const nested = join(outer, "node_modules", "nested");
  await mkdir(join(outer, "dist"), { recursive: true });
  await mkdir(join(outer, "src"), { recursive: true });
  await mkdir(join(outer, "tests"), { recursive: true });
  await mkdir(join(nested, "dist"), { recursive: true });
  await mkdir(join(nested, "src"), { recursive: true });
  await writeFile(join(outer, "package.json"), JSON.stringify({
    exports: {
      ".": { source: "./src/index.ts", import: "./dist/index.js", require: "./dist/index.cjs" },
      "./test-utils": "./test-utils.js",
    },
  }));
  await writeFile(join(nested, "package.json"), JSON.stringify({ main: "./dist/index.js" }));

  const entries = [
    "./node_modules/outer/package.json",
    "./node_modules/outer/dist/index.js",
    "./node_modules/outer/dist/index.cjs",
    "./node_modules/outer/src/index.ts",
    "./node_modules/outer/tests/unit.test.ts",
    "./node_modules/outer/test-utils.js",
    "./node_modules/outer/node_modules/nested/package.json",
    "./node_modules/outer/node_modules/nested/dist/index.js",
    "./node_modules/outer/node_modules/nested/src/index.tsx",
  ];
  const result = analyzeThirdPartyPayload(root, entries);

  assert.deepEqual(result.runtimeTargetPaths, [
    "./node_modules/outer/dist/index.cjs",
    "./node_modules/outer/dist/index.js",
    "./node_modules/outer/node_modules/nested/dist/index.js",
    "./node_modules/outer/test-utils.js",
  ]);
  assert.deepEqual(result.thirdPartyProtectedDevelopmentPaths, [
    "./node_modules/outer/test-utils.js",
  ]);
  assert.deepEqual(result.removableDevelopmentPaths, [
    "./node_modules/outer/node_modules/nested/src/index.tsx",
    "./node_modules/outer/src/index.ts",
    "./node_modules/outer/tests/unit.test.ts",
  ]);
  assert.equal(result.thirdPartyTypeScriptSourceEntries, 2);
  assert.equal(result.thirdPartyTestSuiteEntries, 2);
});
