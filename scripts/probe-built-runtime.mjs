import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEFAULT_POLICY,
  ICON_PICKER_SESSION_META_KEY,
  KERNEL_VERSION,
  MAX_MCP_TOOL_CATALOG_BYTES,
} from "../dist/core/contracts.js";
import { IconKernel } from "../dist/core/kernel.js";

const workspace = process.cwd();
const entryDirectory = mkdtempSync(join(tmpdir(), "icon svg select runtime-"));
const cliEntry = join(entryDirectory, "armorial");
const mcpEntry = join(entryDirectory, "armorial-mcp");
symlinkSync(resolve(workspace, "dist/adapters/cli.js"), cliEntry);
symlinkSync(resolve(workspace, "dist/adapters/mcp.js"), mcpEntry);
const cleanEntryDirectory = () => rmSync(entryDirectory, { recursive: true, force: true });
process.once("exit", cleanEntryDirectory);

const version = execFileSync(
  process.execPath,
  [cliEntry, "--version"],
  { cwd: workspace, encoding: "utf8" },
).trim();
assert.equal(version, KERNEL_VERSION);

function iconParkStrokeWeight(icon) {
  return Number(icon.asset.svg.match(/stroke-width="([^"]+)"/)?.[1]);
}

const hotKernel = new IconKernel();
hotKernel.search({ query: "我要新增图标", limit: 8 });
const searchIterations = 10;
const searchStartedAt = performance.now();
for (let index = 0; index < searchIterations; index += 1) {
  hotKernel.search({ query: "我要新增图标", limit: 8 });
}
const hotSearchMilliseconds = performance.now() - searchStartedAt;
assert.ok(
  hotSearchMilliseconds < 1000,
  `${searchIterations} hot semantic searches took ${hotSearchMilliseconds.toFixed(1)}ms.`,
);

const search = JSON.parse(execFileSync(
  process.execPath,
  ["dist/adapters/cli.js", "search", "settings", "--limit", "3", "--format", "json"],
  { cwd: workspace, encoding: "utf8" },
));
assert.equal(search.status, "ok");
assert.equal(search.items[0]?.id, "icon-park:setting");

const notificationSearch = JSON.parse(execFileSync(
  process.execPath,
  [cliEntry, "search", "通知", "--limit", "3", "--format", "json"],
  { cwd: workspace, encoding: "utf8" },
));
assert.equal(notificationSearch.items[0]?.id, "icon-park:remind");

const ordinaryPhrase = JSON.parse(execFileSync(
  process.execPath,
  ["dist/adapters/cli.js", "resolve", "我要新增图标", "--format", "json"],
  { cwd: workspace, encoding: "utf8" },
));
assert.equal(ordinaryPhrase.status, "ok");
assert.equal(ordinaryPhrase.icon?.id, "icon-park:add");

const pinnedPhrase = JSON.parse(execFileSync(
  process.execPath,
  [cliEntry, "resolve", "settings icon", "--policy", "icon-policy.example.json", "--format", "json"],
  { cwd: workspace, encoding: "utf8" },
));
assert.equal(pinnedPhrase.status, "ok");
assert.equal(pinnedPhrase.selectionMethod, "policy");
assert.equal(pinnedPhrase.icon?.id, "icon-park:setting-two");
assert.equal(iconParkStrokeWeight(pinnedPhrase.icon), 4);

const compoundPhrase = spawnSync(
  process.execPath,
  [cliEntry, "resolve", "delete settings", "--policy", "icon-policy.example.json", "--format", "json"],
  { cwd: workspace, encoding: "utf8" },
);
assert.equal(compoundPhrase.status, 2);
assert.equal(JSON.parse(compoundPhrase.stdout).status, "ambiguous");
assert.equal(JSON.parse(compoundPhrase.stdout).error?.code, "ICON_AMBIGUOUS");

const invalidOption = spawnSync(
  process.execPath,
  [cliEntry, "search", "settings", "--invented"],
  { cwd: workspace, encoding: "utf8" },
);
assert.equal(invalidOption.status, 2);
assert.equal(JSON.parse(invalidOption.stderr).error?.code, "INVALID_INPUT");

const genericPhrase = spawnSync(
  process.execPath,
  ["dist/adapters/cli.js", "resolve", "我要一个图标", "--format", "json"],
  { cwd: workspace, encoding: "utf8" },
);
assert.equal(genericPhrase.status, 2);
assert.equal(JSON.parse(genericPhrase.stdout).error?.code, "ICON_NOT_FOUND");

const inheritedContext = JSON.parse(execFileSync(
  process.execPath,
  ["dist/adapters/cli.js", "get", "search", "--context", "toString", "--format", "json"],
  { cwd: workspace, encoding: "utf8" },
));
assert.deepEqual(
  inheritedContext.icon?.warnings?.map((warning) => warning.code),
  ["CONTEXT_NOT_CONFIGURED"],
);

const svg = execFileSync(
  process.execPath,
  ["dist/adapters/cli.js", "get", "icon-park:search", "--format", "svg"],
  { cwd: workspace, encoding: "utf8" },
);
assert.match(svg, /<svg width="24" height="24"/);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpEntry, "--policy", "icon-policy.example.json"],
  cwd: workspace,
  stderr: "pipe",
});
const client = new Client({ name: "armorial-built-probe", version: "1.0.0" });
await client.connect(transport);

let toolNames;
let resolvedId;
let ordinaryPhraseId;
let compoundPhraseStatus;
let toolCatalogBytes;
let searchedId;
let notificationId;
let renderedId;
let renderedStrokeWidth;
let batchSummary;
let pickerSessionKind;
let pickerEnvelopeBytes;
let browseTop;
let pickerResourceBytes;
try {
  const tools = await client.listTools();
  toolCatalogBytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
  assert.ok(toolCatalogBytes <= MAX_MCP_TOOL_CATALOG_BYTES);
  toolNames = tools.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, ["resolve_icon", "search_icons", "get_icon", "get_icons", "choose_icon", "browse_icons"]);
  const chooseTool = tools.tools.find((tool) => tool.name === "choose_icon");
  const browseTool = tools.tools.find((tool) => tool.name === "browse_icons");
  assert.deepEqual(chooseTool?._meta?.ui?.visibility, ["model"]);
  assert.deepEqual(browseTool?._meta?.ui?.visibility, ["app"]);

  const result = await client.callTool({
    name: "resolve_icon",
    arguments: { intent: "我要一个设置图标", context: "toolbar", alternatives: 2 },
  });
  assert.equal(result.isError, undefined);
  const envelope = result.structuredContent;
  resolvedId = envelope?.result?.icon?.id;
  assert.equal(resolvedId, "icon-park:setting-two");

  const phraseResult = await client.callTool({
    name: "resolve_icon",
    arguments: { intent: "我要新增图标", alternatives: 2 },
  });
  assert.equal(phraseResult.isError, undefined);
  ordinaryPhraseId = phraseResult.structuredContent?.result?.icon?.id;
  assert.equal(ordinaryPhraseId, "icon-park:add");

  const compoundResult = await client.callTool({
    name: "resolve_icon",
    arguments: { intent: "delete settings", alternatives: 2 },
  });
  assert.equal(compoundResult.isError, undefined);
  compoundPhraseStatus = compoundResult.structuredContent?.result?.status;
  assert.equal(compoundPhraseStatus, "ambiguous");
  assert.equal(compoundResult.structuredContent?.result?.error?.code, "ICON_AMBIGUOUS");

  const searchResult = await client.callTool({
    name: "search_icons",
    arguments: { query: "search", limit: 2 },
  });
  assert.equal(searchResult.isError, undefined);
  searchedId = searchResult.structuredContent?.result?.items?.[0]?.id;
  assert.equal(searchedId, "icon-park:search");

  const notificationResult = await client.callTool({
    name: "search_icons",
    arguments: { query: "通知", limit: 2 },
  });
  assert.equal(notificationResult.isError, undefined);
  notificationId = notificationResult.structuredContent?.result?.items?.[0]?.id;
  assert.equal(notificationId, "icon-park:remind");

  const getResult = await client.callTool({
    name: "get_icon",
    arguments: { id: "search", context: "toolbar" },
  });
  assert.equal(getResult.isError, undefined);
  renderedId = getResult.structuredContent?.result?.icon?.id;
  assert.equal(renderedId, "icon-park:search");
  renderedStrokeWidth = iconParkStrokeWeight(getResult.structuredContent.result.icon);
  assert.equal(renderedStrokeWidth, 4);

  const batchResult = await client.callTool({
    name: "get_icons",
    arguments: { ids: ["search", "not-a-real-icon"] },
  });
  assert.equal(batchResult.isError, undefined);
  batchSummary = batchResult.structuredContent?.result?.summary;
  assert.deepEqual(batchSummary, { requested: 2, rendered: 1, failed: 1 });

  const pickerResult = await client.callTool({
    name: "choose_icon",
    arguments: { intent: "notification", requestId: "runtime-probe" },
  });
  assert.equal(pickerResult.isError, undefined);
  pickerEnvelopeBytes = Buffer.byteLength(JSON.stringify(pickerResult.structuredContent), "utf8");
  assert.ok(pickerEnvelopeBytes <= MAX_MCP_TOOL_CATALOG_BYTES);
  const pickerSummary = pickerResult.structuredContent?.result ?? {};
  pickerSessionKind = pickerSummary.kind;
  assert.equal(pickerSessionKind, "icon_picker_session");
  assert.equal("items" in pickerSummary, false);
  assert.equal(pickerResult._meta?.[ICON_PICKER_SESSION_META_KEY]?.requestId, "runtime-probe");

  const browseResult = await client.callTool({
    name: "browse_icons",
    arguments: { query: "notification", offset: 0, limit: 8 },
  });
  assert.equal(browseResult.isError, undefined);
  browseTop = browseResult.structuredContent?.result?.items?.[0]?.id;
  assert.equal(browseTop, "icon-park:remind");
  assert.match(browseResult.structuredContent?.result?.items?.[0]?.asset?.svg ?? "", /<svg/);

  const resources = await client.listResources();
  assert.equal(resources.resources.some((resource) => resource.uri === "ui://icon-svg-select/picker.html"), true);
  const pickerResource = await client.readResource({ uri: "ui://icon-svg-select/picker.html" });
  const pickerHtml = pickerResource.contents[0]?.text ?? "";
  pickerResourceBytes = Buffer.byteLength(pickerHtml, "utf8");
  assert.ok(pickerResourceBytes > 100_000);
  assert.equal(pickerResource.contents[0]?.mimeType, "text/html;profile=mcp-app");
} finally {
  await client.close();
}

// Plugin hosts launch the MCP entry without arguments, so the project policy
// must still reach the built server through the working directory or the
// ICON_SVG_SELECT_POLICY environment variable.
async function resolveWithoutArguments(cwd, env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpEntry],
    cwd,
    env,
    stderr: "pipe",
  });
  const probeClient = new Client({ name: "armorial-installed-probe", version: "1.0.0" });
  await probeClient.connect(transport);
  try {
    const result = await probeClient.callTool({
      name: "resolve_icon",
      arguments: { intent: "设置", context: "toolbar", alternatives: 2 },
    });
    assert.equal(result.isError, undefined);
    const summary = result.structuredContent?.result;
    assert.equal(summary?.selectionMethod, "policy");
    assert.equal(summary?.icon?.id, "icon-park:setting-two");
    return summary.icon.id;
  } finally {
    await probeClient.close();
  }
}

const discoveryDirectory = mkdtempSync(join(tmpdir(), "icon svg select discovery-"));
const environmentDirectory = mkdtempSync(join(tmpdir(), "icon svg select environment-"));
const projectPolicyPath = join(discoveryDirectory, "icon-policy.json");
writeFileSync(projectPolicyPath, JSON.stringify({
  ...structuredClone(DEFAULT_POLICY),
  selections: { settings: "icon-park:setting-two", 设置: "icon-park:setting-two" },
}));
const cleanEnvironment = { ...process.env };
delete cleanEnvironment.ICON_SVG_SELECT_POLICY;
const discoveredResolvedId = await resolveWithoutArguments(discoveryDirectory, cleanEnvironment);
const envResolvedId = await resolveWithoutArguments(environmentDirectory, {
  ...cleanEnvironment,
  ICON_SVG_SELECT_POLICY: projectPolicyPath,
});
rmSync(discoveryDirectory, { recursive: true, force: true });
rmSync(environmentDirectory, { recursive: true, force: true });

process.removeListener("exit", cleanEntryDirectory);
cleanEntryDirectory();

process.stdout.write(`${JSON.stringify({
  status: "ok",
  cli: {
    searchTop: search.items[0].id,
    notificationTop: notificationSearch.items[0].id,
    ordinaryPhraseId: ordinaryPhrase.icon.id,
    pinnedPhraseId: pinnedPhrase.icon.id,
    compoundPhraseStatus: "ambiguous",
    genericPhraseError: "ICON_NOT_FOUND",
    invalidOptionError: "INVALID_INPUT",
    inheritedContextWarning: "CONTEXT_NOT_CONFIGURED",
    hotSearchMilliseconds: Number(hotSearchMilliseconds.toFixed(1)),
    svgBytes: Buffer.byteLength(svg, "utf8"),
  },
  mcp: {
    tools: toolNames,
    toolCatalogBytes,
    resolvedId,
    ordinaryPhraseId,
    compoundPhraseStatus,
    searchedId,
    notificationId,
    renderedId,
    renderedStrokeWidth,
    batchSummary,
    pickerSessionKind,
    pickerEnvelopeBytes,
    browseTop,
    pickerResourceBytes,
  },
  installedState: {
    discoveredResolvedId,
    envResolvedId,
  },
})}\n`);
