import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DEFAULT_POLICY, ICON_PICKER_SESSION_META_KEY } from "../src/core/contracts.js";
import { removeOwnedTree } from "./stage-plugin.js";

const workspace = resolve(import.meta.dirname, "..");
const pluginDirectory = realpathSync(resolve(
  process.env.ICON_SVG_SELECT_PLUGIN_DIRECTORY ?? join(workspace, "plugins", "armorial"),
));
const packageJson = JSON.parse(readFileSync(join(pluginDirectory, "package.json"), "utf8")) as {
  version: string;
  author?: string;
  license?: string;
};
const manifest = JSON.parse(readFileSync(join(pluginDirectory, ".codex-plugin", "plugin.json"), "utf8")) as {
  version: string;
};
const mcpConfig = JSON.parse(readFileSync(join(pluginDirectory, ".mcp.json"), "utf8")) as {
  mcpServers: { icon_svg_select: { args: string[]; cwd: string; env_vars?: string[] } };
};

assert.match(manifest.version, new RegExp(`^${packageJson.version.replaceAll(".", "\\.")}\\+codex\\.local-\\d{8}-\\d{6}$`));
assert.deepEqual(mcpConfig.mcpServers.icon_svg_select.args, ["./dist/adapters/mcp.js"]);
assert.equal(mcpConfig.mcpServers.icon_svg_select.cwd, ".");
assert.deepEqual(mcpConfig.mcpServers.icon_svg_select.env_vars, ["ICON_SVG_SELECT_POLICY"]);
assert.equal(existsSync(join(pluginDirectory, ".armorial-generated")), true);
assert.equal(existsSync(join(pluginDirectory, "package-lock.json")), false);
assert.equal(existsSync(join(pluginDirectory, "node_modules", "typescript")), false);
assert.equal(existsSync(join(pluginDirectory, "dist", "adapters", "publication-contract.js")), true);
assert.equal(existsSync(join(pluginDirectory, "dist", "adapters", "publish-helper.js")), true);
assert.equal(packageJson.author, "openAdam");
assert.equal(packageJson.license, "Apache-2.0");
for (const fileName of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
  assert.equal(existsSync(join(pluginDirectory, fileName)), true, `${fileName} must ship in the staged package`);
}
assert.equal(
  existsSync(join(pluginDirectory, "figma-plugin")),
  false,
  "the npm/Codex package must not ship the separately distributed Figma development plugin",
);
const rootNotices = readFileSync(join(pluginDirectory, "THIRD_PARTY_NOTICES.md"), "utf8");
for (const dependency of [
  "@icon-park/svg@1.4.2",
  "@modelcontextprotocol/ext-apps@1.7.5",
  "@modelcontextprotocol/sdk@1.30.0",
  "@noble/hashes@2.3.0",
  "zod-to-json-schema@3.25.2",
]) {
  assert.match(rootNotices, new RegExp(`^## ${dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
}
// License manifests are scan-build intermediates; they must never ship inside
// publishable dist output.
for (const stray of ["figma-plugin/dist/.vite", "dist/web/.vite", "dist/mcp-app/.vite"]) {
  assert.equal(existsSync(join(pluginDirectory, stray)), false, `${stray} must not ship in the staged package`);
}

const dependencyTree = JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], {
  cwd: pluginDirectory,
  encoding: "utf8",
})) as { problems?: string[] };
assert.deepEqual(dependencyTree.problems ?? [], []);
const installedDependencies = new Set(
  execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
    cwd: pluginDirectory,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .map((directory) => directory.trim())
    .filter((directory) => directory.length > 0 && resolve(directory) !== pluginDirectory)
    .map((directory) => {
      const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      assert.equal(typeof metadata.name, "string", `${directory} must expose an installed package name`);
      assert.equal(typeof metadata.version, "string", `${directory} must expose an installed version`);
      return `${metadata.name}@${metadata.version}`;
    }),
);
for (const dependency of installedDependencies) {
  assert.match(
    rootNotices,
    new RegExp(`^## ${dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
    `${dependency} must appear in the root third-party inventory`,
  );
}

const temporaryRoot = realpathSync(tmpdir());
const projectDirectory = mkdtempSync(join(temporaryRoot, "armorial-plugin-probe-"));
const policyPath = join(projectDirectory, "project-policy.json");
writeFileSync(policyPath, JSON.stringify({
  ...structuredClone(DEFAULT_POLICY),
  selections: { settings: "icon-park:setting-two", 设置: "icon-park:setting-two" },
}));

const cleanEnvironment = { ...process.env, ICON_SVG_SELECT_POLICY: policyPath };
const entry = join(pluginDirectory, "dist", "adapters", "mcp.js");
const candidateObservation = JSON.parse(execFileSync(process.execPath, [
  join(workspace, "scripts/probe-inline-candidate.mjs"),
  "--cli",
  join(pluginDirectory, "dist", "adapters", "cli.js"),
], { encoding: "utf8" })) as { status?: unknown; outputRace?: unknown; hardLinkRace?: unknown; optimistic?: unknown[] };
assert.equal(candidateObservation.status, "ok");
assert.equal(candidateObservation.outputRace, "INVALID_INPUT+competing-output-preserved");
assert.equal(candidateObservation.hardLinkRace, "INVALID_INPUT+source-alias-preserved");
assert.equal(candidateObservation.optimistic?.length, 2);
const pinObservation = JSON.parse(execFileSync(process.execPath, [
  join(workspace, "scripts/probe-pinned-publication.mjs"),
  "--cli",
  join(pluginDirectory, "dist", "adapters", "cli.js"),
], { encoding: "utf8" })) as { status?: unknown; swaps?: unknown[]; helperFailures?: unknown[]; publicationSuccesses?: unknown[]; postCommitCleanupWarnings?: unknown[]; postCommitInterruptions?: unknown[]; svgOverwrite?: unknown; restrictiveUmask?: unknown; productionTestHooks?: unknown };
assert.equal(pinObservation.status, "ok");
assert.equal(pinObservation.swaps?.length, 6);
assert.equal(pinObservation.helperFailures?.length, 8);
assert.equal(pinObservation.publicationSuccesses?.length, 4);
assert.equal(pinObservation.postCommitCleanupWarnings?.length, 2);
assert.equal(pinObservation.postCommitInterruptions?.length, 8);
assert.deepEqual(pinObservation.svgOverwrite, {
  unnecessary: "absent-output-rejected",
  default: "existing-output-preserved",
  explicit: "optimistic-window-reproduced-and-disclosed",
});
assert.equal(pinObservation.restrictiveUmask, "0600-new-svg");
assert.equal(pinObservation.productionTestHooks, "legacy-test-environment-ignored");
const basenameObservation = JSON.parse(execFileSync(process.execPath, [
  join(workspace, "scripts/probe-publication-basename.mjs"),
  "--cli",
  join(pluginDirectory, "dist", "adapters", "cli.js"),
], { encoding: "utf8" })) as { status?: unknown; observations?: unknown[] };
assert.equal(basenameObservation.status, "ok");
assert.equal(basenameObservation.observations?.length, 24);
const cancellationObservation = JSON.parse(execFileSync(process.execPath, [
  join(workspace, "scripts/probe-publish-parent-cancellation.mjs"),
  "--cli",
  join(pluginDirectory, "dist", "adapters", "cli.js"),
  "--deadline",
], { encoding: "utf8" })) as { status?: unknown; cancellation?: unknown[]; deadline?: unknown; cleanupRevocation?: unknown };
assert.equal(cancellationObservation.status, "ok");
assert.equal(cancellationObservation.cancellation?.length, 4);
assert.equal(cancellationObservation.deadline, "bounded-before-commit+no-final-effect");
assert.deepEqual(cancellationObservation.cleanupRevocation, {
  status: "deadline-cause+cleanup-failure+private-complete-residue",
  effect: "none",
  cleanup: "failed",
  mode: "0600",
});
const conflictObservation = JSON.parse(execFileSync(process.execPath, [
  join(workspace, "scripts/probe-inline-conflict.mjs"),
  "--cli",
  join(pluginDirectory, "dist", "adapters", "cli.js"),
], { encoding: "utf8" })) as { status?: unknown; observations?: Array<{ code?: unknown; residue?: unknown }> };
assert.equal(conflictObservation.status, "ok");
assert.equal(conflictObservation.observations?.length, 2);
assert.equal(conflictObservation.observations?.every(({ code, residue }) => code === "INVALID_INPUT" && residue === 0), true);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: pluginDirectory,
  env: cleanEnvironment,
  stderr: "pipe",
});
const client = new Client({ name: "armorial-staged-probe", version: "1.0.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["browse_icons", "choose_icon", "get_icon", "get_icons", "resolve_icon", "search_icons"],
  );
  const result = await client.callTool({
    name: "resolve_icon",
    arguments: { intent: "设置", context: "toolbar", alternatives: 2 },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    result?: { selectionMethod?: unknown; icon?: { id?: unknown } };
  } | undefined;
  assert.equal(structured?.result?.selectionMethod, "policy");
  assert.equal(structured?.result?.icon?.id, "icon-park:setting-two");

  const searched = await client.callTool({
    name: "search_icons",
    arguments: { query: "search", limit: 2 },
  });
  assert.equal(searched.isError, undefined);
  const searchedResult = searched.structuredContent as {
    result?: { items?: Array<{ id?: unknown }> };
  } | undefined;
  assert.equal(searchedResult?.result?.items?.[0]?.id, "icon-park:search");

  const compositionalSearch = await client.callTool({
    name: "search_icons",
    arguments: { query: "right rotate object", limit: 10 },
  });
  assert.equal(compositionalSearch.isError, undefined);
  const compositionalResult = compositionalSearch.structuredContent as {
    result?: { items?: Array<{ id?: unknown; rankScore?: number }> };
  } | undefined;
  const compositionalItems = compositionalResult?.result?.items ?? [];
  assert.ok(compositionalItems.slice(0, 2).some((item) => item.id === "icon-park:rotate"));
  assert.ok(
    (compositionalItems.find((item) => item.id === "icon-park:rotate")?.rankScore ?? 0) >
      (compositionalItems.find((item) => item.id === "icon-park:align-right")?.rankScore ?? 0),
  );

  const boundarySearch = await client.callTool({
    name: "search_icons",
    arguments: { query: "clockwise", limit: 8 },
  });
  assert.equal(boundarySearch.isError, undefined);
  const boundarySearchResult = boundarySearch.structuredContent as {
    result?: { items?: Array<{ id?: unknown }> };
  } | undefined;
  assert.equal(
    boundarySearchResult?.result?.items?.some((item) => item.id === "icon-park:lock"),
    false,
  );

  const boundaryResolution = await client.callTool({
    name: "resolve_icon",
    arguments: { intent: "clockwise", alternatives: 3 },
  });
  assert.equal(boundaryResolution.isError, undefined);
  const boundaryResolutionResult = boundaryResolution.structuredContent as {
    result?: { icon?: { id?: unknown } };
  } | undefined;
  assert.equal(boundaryResolutionResult?.result?.icon?.id, "icon-park:rotating-forward");

  const rendered = await client.callTool({
    name: "get_icon",
    arguments: { id: "search" },
  });
  assert.equal(rendered.isError, undefined);
  const renderedResult = rendered.structuredContent as {
    result?: { icon?: { id?: unknown; asset?: { svg?: unknown } } };
  } | undefined;
  assert.equal(renderedResult?.result?.icon?.id, "icon-park:search");
  assert.match(String(renderedResult?.result?.icon?.asset?.svg), /<svg/);

  const compound = await client.callTool({
    name: "resolve_icon",
    arguments: { intent: "delete settings", alternatives: 2 },
  });
  assert.equal(compound.isError, undefined);
  const compoundResult = compound.structuredContent as {
    result?: { status?: unknown; error?: { code?: unknown } };
  } | undefined;
  assert.equal(compoundResult?.result?.status, "ambiguous");
  assert.equal(compoundResult?.result?.error?.code, "ICON_AMBIGUOUS");

  const lazyRenderers = await client.callTool({
    name: "get_icons",
    arguments: { ids: ["abnormal", "airplane"] },
  });
  assert.equal(lazyRenderers.isError, undefined);
  const lazyRendererResult = lazyRenderers.structuredContent as {
    result?: { status?: unknown; summary?: { rendered?: unknown; failed?: unknown } };
  } | undefined;
  assert.equal(lazyRendererResult?.result?.status, "ok");
  assert.equal(lazyRendererResult?.result?.summary?.rendered, 2);
  assert.equal(lazyRendererResult?.result?.summary?.failed, 0);

  const picker = await client.callTool({
    name: "choose_icon",
    arguments: { intent: "notification", requestId: "installed-probe" },
  });
  assert.equal(picker.isError, undefined);
  const pickerResult = picker.structuredContent as {
    result?: { kind?: unknown; resourceUri?: unknown; items?: unknown };
  } | undefined;
  assert.equal(pickerResult?.result?.kind, "icon_picker_session");
  assert.equal(pickerResult?.result?.resourceUri, "ui://icon-svg-select/picker.html");
  assert.equal(pickerResult?.result?.items, undefined);
  const pickerMeta = picker._meta?.[ICON_PICKER_SESSION_META_KEY] as { requestId?: unknown } | undefined;
  assert.equal(pickerMeta?.requestId, "installed-probe");

  const browsed = await client.callTool({
    name: "browse_icons",
    arguments: { query: "notification", offset: 0, limit: 4 },
  });
  assert.equal(browsed.isError, undefined);
  const browsedResult = browsed.structuredContent as {
    result?: { items?: Array<{ id?: unknown; asset?: { svg?: unknown } }> };
  } | undefined;
  assert.equal(browsedResult?.result?.items?.[0]?.id, "icon-park:remind");
  assert.match(String(browsedResult?.result?.items?.[0]?.asset?.svg), /<svg/);

  const resources = await client.listResources();
  assert.equal(resources.resources.some((resource) => resource.uri === "ui://icon-svg-select/picker.html"), true);
  const pickerResource = await client.readResource({ uri: "ui://icon-svg-select/picker.html" });
  assert.equal(pickerResource.contents[0]?.mimeType, "text/html;profile=mcp-app");
  assert.ok(Buffer.byteLength((pickerResource.contents[0] as { text?: string } | undefined)?.text ?? "", "utf8") > 100_000);
} finally {
  await client.close();
  removeOwnedTree(projectDirectory, temporaryRoot, ["armorial-plugin-probe-"]);
}

process.stdout.write(`${JSON.stringify({
  status: "ok",
  pluginVersion: manifest.version,
  packageVersion: packageJson.version,
  policyIcon: "icon-park:setting-two",
  compoundIntent: "ambiguous",
  lazyRenderers: 2,
  routes: ["resolve", "search", "get", "batch", "inline-candidate", "inline-conflict", "choose", "browse", "resource"],
})}\n`);
