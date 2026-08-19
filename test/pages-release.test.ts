import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("GitHub Pages is the official static human workbench", async () => {
  const [packageSource, readme, workflow, ciWorkflow, viteConfig, gitignore] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource) as {
    homepage?: string;
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.homepage, "https://tetracoralla.github.io/armorial/");
  assert.match(readme, /https:\/\/tetracoralla\.github\.io\/armorial\//);
  assert.equal(packageJson.scripts?.["build:pages"], "ARMORIAL_PAGES=1 vite build");
  assert.match(packageJson.scripts?.["pages:check"] ?? "", /check-pages-catalog\.ts/);
  assert.match(packageJson.scripts?.["check"] ?? "", /npm run pages:check/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[CI\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /npm run build:pages/);
  assert.doesNotMatch(workflow, /playwright install|npm run check/);
  assert.match(ciWorkflow, /npx playwright install chromium/);
  assert.doesNotMatch(ciWorkflow, /playwright install --with-deps/);
  assert.match(workflow, /path: \.pages-dist/);
  assert.match(workflow, /npm run pages:deployment:check/);
  assert.match(viteConfig, /pagesIconCatalogAsset/);
  assert.match(viteConfig, /pagesProviderAlias/);
  assert.match(viteConfig, /browserStandaloneRuntimeAlias/);
  assert.match(viteConfig, /\.pages-dist/);
  assert.match(gitignore, /^\.pages-dist\/$/m);
});
