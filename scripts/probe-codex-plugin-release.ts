import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const workspace = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as { version: string };
const releaseDirectory = resolve(process.env.ARMORIAL_RELEASE_DIRECTORY ?? join(workspace, ".release"));
const archive = resolve(process.env.ARMORIAL_PLUGIN_ARCHIVE
  ?? join(releaseDirectory, `armorial-${packageJson.version}-codex-plugin-macos-arm64.tar.gz`));
const checksum = `${archive}.sha256`;
assert.equal(existsSync(archive), true, `Missing immutable plugin archive: ${archive}`);
assert.equal(existsSync(checksum), true, `Missing immutable plugin checksum: ${checksum}`);
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
assert.equal(readFileSync(checksum, "utf8"), `${digest}  ${basename(archive)}\n`);

const temporaryRoot = mkdtempSync(join(tmpdir(), "armorial-immutable-probe-"));
const pluginDirectory = join(temporaryRoot, "unpack");
try {
  mkdirSync(pluginDirectory);
  execFileSync("tar", ["-xzf", archive, "-C", pluginDirectory, "--strip-components=1"], { stdio: "ignore" });
  const runtime = readFileSync(join(pluginDirectory, "RUNTIME.md"), "utf8");
  assert.match(runtime, /Agent Host binds that command to the Node runtime/);
  assert.match(runtime, /already manages/);
  const manifest = JSON.parse(readFileSync(join(pluginDirectory, ".codex-plugin/plugin.json"), "utf8")) as { name?: unknown; version?: unknown };
  const packageManifest = JSON.parse(readFileSync(join(pluginDirectory, "package.json"), "utf8")) as { name?: unknown; version?: unknown; scripts?: unknown; bin?: unknown };
  assert.equal(manifest.name, "armorial");
  assert.equal(manifest.version, packageManifest.version);
  assert.equal(packageManifest.version, packageJson.version);
  assert.equal(packageManifest.scripts, undefined);
  assert.equal(packageManifest.bin, undefined);
  const cli = join(pluginDirectory, "dist/adapters/cli.js");
  assert.equal(execFileSync(process.execPath, [cli, "--version"], { cwd: pluginDirectory, encoding: "utf8" }).trim(), packageJson.version);
  const cliResolved = JSON.parse(execFileSync(process.execPath, [cli, "resolve", "search", "--format", "json"], {
    cwd: pluginDirectory,
    encoding: "utf8",
  })) as { status?: unknown; icon?: { id?: unknown; asset?: { svg?: unknown } } };
  assert.equal(cliResolved.status, "ok");
  assert.equal(cliResolved.icon?.id, "icon-park:search");
  assert.match(String(cliResolved.icon?.asset?.svg), /<svg/);
  for (const [fileName, unsafeHtml] of new Map([
    ["script-pseudo-body.html", '<!doctype html><html><head><script>const template = "<body>";</script></head></html>\n'],
    ["head-marker-block.html", "<!doctype html><html><head><!-- armorial:sprite:start --><!-- armorial:sprite:end --></head><body><main>keep</main></body></html>\n"],
  ])) {
    const unsafeHtmlPath = join(temporaryRoot, fileName);
    writeFileSync(unsafeHtmlPath, unsafeHtml, "utf8");
    const unsafeInline = spawnSync(process.execPath, [
      cli,
      "batch",
      "icon-park:search",
      "--inline-into",
      basename(unsafeHtmlPath),
    ], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(unsafeInline.status, 2, unsafeInline.stderr);
    assert.equal(unsafeInline.stdout, "");
    assert.equal(JSON.parse(unsafeInline.stderr).error.code, "INVALID_INPUT");
    assert.equal(readFileSync(unsafeHtmlPath, "utf8"), unsafeHtml, "immutable CLI must fail before mutation");
  }

  const validHtmlPath = join(temporaryRoot, "valid-body.html");
  writeFileSync(validHtmlPath, '<!doctype html><html><body data-fixture="kept"><svg><use href="#armorial-search"></use></svg></body></html>\n', "utf8");
  const validInline = JSON.parse(execFileSync(process.execPath, [
    cli,
    "batch",
    "icon-park:search",
    "--inline-into",
    basename(validHtmlPath),
  ], { cwd: temporaryRoot, encoding: "utf8" })) as { status?: unknown; kind?: unknown; symbols?: unknown };
  assert.deepEqual(validInline, {
    status: "ok",
    kind: "icon_sprite_inline",
    output: "valid-body.html",
    bytes: Buffer.byteLength(readFileSync(validHtmlPath)),
    sha256: `sha256:${createHash("sha256").update(readFileSync(validHtmlPath)).digest("hex")}`,
    symbols: 1,
  });
  assert.match(readFileSync(validHtmlPath, "utf8"), /<symbol id="armorial-search"/);
  const resourceObservation = JSON.parse(execFileSync(process.execPath, [
    join(workspace, "scripts/probe-inline-resource.mjs"),
    "--module",
    join(pluginDirectory, "dist/adapters/cli-artifact.js"),
  ], { encoding: "utf8" })) as { status?: unknown; observations?: unknown[] };
  assert.equal(resourceObservation.status, "ok");
  assert.equal(resourceObservation.observations?.length, 4);
  const transitionObservation = JSON.parse(execFileSync(process.execPath, [
    join(workspace, "scripts/probe-inline-transition.mjs"),
    "--cli",
    cli,
  ], { encoding: "utf8" })) as {
    status?: unknown;
    contract?: { callerBytes?: number };
    transition?: { firstBytes?: number; replacementBytes?: number; overLimit?: unknown };
  };
  assert.equal(transitionObservation.status, "ok");
  assert.equal(transitionObservation.transition?.overLimit, "INVALID_INPUT");
  assert.ok(
    Number(transitionObservation.transition?.firstBytes) > Number(transitionObservation.contract?.callerBytes),
  );
  assert.ok(
    Number(transitionObservation.transition?.replacementBytes) > Number(transitionObservation.contract?.callerBytes),
  );
  const mcpConfig = JSON.parse(readFileSync(join(pluginDirectory, ".mcp.json"), "utf8")) as {
    mcpServers?: { icon_svg_select?: { command?: unknown; args?: unknown; cwd?: unknown } };
  };
  assert.equal(mcpConfig.mcpServers?.icon_svg_select?.command, "node");
  assert.deepEqual(mcpConfig.mcpServers?.icon_svg_select?.args, ["./dist/adapters/mcp.js"]);
  assert.equal(mcpConfig.mcpServers?.icon_svg_select?.cwd, ".");
  for (const forbidden of ["src", "test", "figma-plugin", "dist/web", "README.md", "package-lock.json", "node_modules/.bin", "node_modules/.package-lock.json"]) {
    assert.equal(existsSync(join(pluginDirectory, forbidden)), false, `artifact must omit ${forbidden}`);
  }
  const sbom = JSON.parse(readFileSync(join(pluginDirectory, "SBOM.spdx.json"), "utf8")) as { spdxVersion?: unknown; packages?: unknown[] };
  assert.equal(sbom.spdxVersion, "SPDX-2.3");
  assert.ok((sbom.packages?.length ?? 0) > 0);
  const notices = readFileSync(join(pluginDirectory, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const dependency of ["@icon-park/svg@1.4.2", "@modelcontextprotocol/sdk@1.30.0", "zod@4.4.3"]) {
    assert.match(notices, new RegExp(`^## ${dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
  assert.deepEqual(JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], { cwd: pluginDirectory, encoding: "utf8" })).problems ?? [], []);
  const installedDependencies = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
    cwd: pluginDirectory,
    encoding: "utf8",
  }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(1);
  const sbomPackages = new Set((sbom.packages ?? []).map((item) => {
    const value = item as { name?: unknown; versionInfo?: unknown };
    return `${String(value.name)}@${String(value.versionInfo)}`;
  }));
  for (const dependencyDirectory of installedDependencies) {
    const dependency = JSON.parse(readFileSync(join(dependencyDirectory, "package.json"), "utf8")) as { name: string; version: string };
    const id = `${dependency.name}@${dependency.version}`;
    assert.match(notices, new RegExp(`^## ${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `${id} needs a notice`);
    assert.equal(sbomPackages.has(id), true, `${id} needs an SPDX package entry`);
  }

  const policyPath = join(temporaryRoot, "policy.json");
  const policy = JSON.parse(readFileSync(join(workspace, "icon-policy.example.json"), "utf8")) as { selections?: Record<string, string> };
  policy.selections = { ...(policy.selections ?? {}), settings: "icon-park:setting-two" };
  writeFileSync(policyPath, JSON.stringify(policy), "utf8");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp"],
    cwd: pluginDirectory,
    env: { ...process.env, ICON_SVG_SELECT_POLICY: policyPath },
    stderr: "pipe",
  });
  const client = new Client({ name: "armorial-immutable-plugin-probe", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ["browse_icons", "choose_icon", "get_icon", "get_icons", "resolve_icon", "search_icons"]);
    const resolved = await client.callTool({ name: "resolve_icon", arguments: { intent: "settings", context: "toolbar" } });
    assert.equal(resolved.isError, undefined);
    assert.equal((resolved.structuredContent as { result?: { icon?: { id?: unknown } } }).result?.icon?.id, "icon-park:setting-two");
    const rendered = await client.callTool({ name: "get_icon", arguments: { id: "icon-park:search" } });
    assert.equal(rendered.isError, undefined);
    assert.match(String((rendered.structuredContent as { result?: { icon?: { asset?: { svg?: unknown } } } }).result?.icon?.asset?.svg), /<svg/);
    const picker = await client.callTool({ name: "choose_icon", arguments: { intent: "notification", requestId: "immutable-probe" } });
    assert.equal(picker.isError, undefined);
    const resources = await client.listResources();
    assert.equal(resources.resources.some((item) => item.uri === "ui://icon-svg-select/picker.html"), true);
    const resource = await client.readResource({ uri: "ui://icon-svg-select/picker.html" });
    assert.equal(resource.contents[0]?.mimeType, "text/html;profile=mcp-app");
  } finally {
    await client.close();
  }
  process.stdout.write(`${JSON.stringify({ status: "ok", archive, sha256: digest, tools: "list+resolve+get+choose", cli: "version+resolve+inline+mcp", resource: "picker" })}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
