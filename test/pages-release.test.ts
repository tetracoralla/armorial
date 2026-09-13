import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

test("GitHub Pages is the official static human workbench", async () => {
  const [
    packageSource,
    readme,
    workflow,
    ciWorkflow,
    viteConfig,
    gitignore,
    indexHtml,
    llmsTxt,
    agentSelection,
    agentSelectionHtml,
    sitemap,
  ] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/llms.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/agent-selection.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/agent-selection.html", import.meta.url), "utf8"),
    readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8"),
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
  assert.match(viteConfig, /pagesSourceCommitAsset/);
  assert.match(viteConfig, /publicDir: isMcpApp \? false : "public"/);
  assert.match(viteConfig, /embeddedWorkbenchMetadataBoundary/);
  assert.match(viteConfig, /pagesProviderAlias/);
  assert.match(viteConfig, /browserStandaloneRuntimeAlias/);
  assert.match(viteConfig, /\.pages-dist/);
  assert.match(gitignore, /^\.pages-dist\/$/m);
  assert.match(indexHtml, /rel="canonical" href="https:\/\/tetracoralla\.github\.io\/armorial\/"/);
  assert.match(indexHtml, /rel="help" href="\.\/agent-selection\.html"/);
  assert.doesNotMatch(indexHtml, /rel="alternate"[^>]+agent-selection\.(?:md|txt)/);
  assert.match(indexHtml, /<meta name="robots" content="index,follow"/);
  assert.match(indexHtml, /<title>Search and render project-aware IconPark SVGs locally — Armorial<\/title>/);
  assert.match(indexHtml, /rel="describedby" href="\.\/llms\.txt" type="text\/markdown"/);
  // Assert discovery links and deployed metadata, not editorial wording or
  // a prescribed sequence of Agent decisions.
  assert.match(llmsTxt, /agent-selection\.html/);
  assert.match(agentSelection, /source-commit\.txt/);
  assert.match(agentSelectionHtml, /rel="canonical" href="https:\/\/tetracoralla\.github\.io\/armorial\/agent-selection\.html"/);
  assert.match(agentSelectionHtml, /rel="alternate" type="text\/plain" href="\.\/agent-selection\.txt"/);
  await assert.rejects(access(new URL("../public/robots.txt", import.meta.url)));
  assert.match(sitemap, /https:\/\/tetracoralla\.github\.io\/armorial\/agent-selection\.html/);
  assert.match(sitemap, /https:\/\/tetracoralla\.github\.io\/armorial\/agent-selection\.txt/);
});
