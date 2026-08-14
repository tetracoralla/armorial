import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MAX_MCP_TOOL_CATALOG_BYTES } from "../dist/core/contracts.js";
import { IconKernel } from "../dist/core/kernel.js";

const workspace = process.cwd();
const entryDirectory = mkdtempSync(join(tmpdir(), "icon svg select runtime-"));
const cliEntry = join(entryDirectory, "icon-svg-select");
const mcpEntry = join(entryDirectory, "icon-svg-select-mcp");
symlinkSync(resolve(workspace, "dist/adapters/cli.js"), cliEntry);
symlinkSync(resolve(workspace, "dist/adapters/mcp.js"), mcpEntry);
const cleanEntryDirectory = () => rmSync(entryDirectory, { recursive: true, force: true });
process.once("exit", cleanEntryDirectory);

const version = execFileSync(
  process.execPath,
  [cliEntry, "--version"],
  { cwd: workspace, encoding: "utf8" },
).trim();
assert.equal(version, "0.1.0");

function visibleStrokeWidth(icon) {
  const nativeStrokeWidth = Number(icon.asset.svg.match(/stroke-width="([^"]+)"/)?.[1]);
  const [, , viewBoxWidth, viewBoxHeight] = icon.asset.viewBox.split(/\s+/).map(Number);
  return nativeStrokeWidth * icon.policy.size / Math.max(viewBoxWidth, viewBoxHeight);
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
assert.equal(visibleStrokeWidth(pinnedPhrase.icon), 2);

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
const client = new Client({ name: "icon-svg-select-built-probe", version: "1.0.0" });
await client.connect(transport);

let toolNames;
let resolvedId;
let ordinaryPhraseId;
let toolCatalogBytes;
let searchedId;
let notificationId;
let renderedId;
let renderedStrokeWidth;
let batchSummary;
let pickerTop;
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
  renderedStrokeWidth = visibleStrokeWidth(getResult.structuredContent.result.icon);
  assert.equal(renderedStrokeWidth, 2);

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
  pickerTop = pickerResult.structuredContent?.result?.items?.[0]?.id;
  assert.equal(pickerTop, "icon-park:remind");
  assert.equal(pickerResult.structuredContent?.session?.requestId, "runtime-probe");

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

process.removeListener("exit", cleanEntryDirectory);
cleanEntryDirectory();

process.stdout.write(`${JSON.stringify({
  status: "ok",
  cli: {
    searchTop: search.items[0].id,
    notificationTop: notificationSearch.items[0].id,
    ordinaryPhraseId: ordinaryPhrase.icon.id,
    pinnedPhraseId: pinnedPhrase.icon.id,
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
    searchedId,
    notificationId,
    renderedId,
    renderedStrokeWidth,
    batchSummary,
    pickerTop,
    pickerResourceBytes,
  },
})}\n`);
