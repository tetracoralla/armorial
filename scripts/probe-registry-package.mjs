import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const workspace = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8"));
const serverJson = JSON.parse(readFileSync(join(workspace, "server.json"), "utf8"));
const temporaryRoot = mkdtempSync(join(tmpdir(), "armorial-registry-package-"));

try {
  const packed = JSON.parse(execFileSync("npm", [
    "pack",
    "--ignore-scripts",
    "--pack-destination",
    temporaryRoot,
    "--json",
  ], { cwd: workspace, encoding: "utf8" }));
  assert.equal(packed.length, 1);
  const archive = join(temporaryRoot, packed[0].filename);
  assert.equal(existsSync(archive), true);
  const paths = new Set(packed[0].files.map((file) => file.path));
  for (const required of [
    "package.json",
    "server.json",
    "dist/adapters/cli.js",
    "dist/adapters/mcp.js",
    "dist/mcp-app/index.html",
    "skills/icon-svg-select/SKILL.md",
  ]) assert.equal(paths.has(required), true, `packed npm route is missing ${required}`);
  assert.equal([...paths].some((path) => path.startsWith("figma-plugin/")), false);
  assert.ok(packed[0].size <= 512 * 1024, `Registry npm package is ${packed[0].size} bytes`);
  assert.ok(packed[0].unpackedSize <= 2 * 1024 * 1024, `Unpacked Registry npm package is ${packed[0].unpackedSize} bytes`);

  const npmEnvironment = {
    ...process.env,
    npm_config_cache: join(temporaryRoot, "npm-cache"),
    npm_config_update_notifier: "false",
  };
  async function probe(label) {
    const startedAt = performance.now();
    const transport = new StdioClientTransport({
      command: "npm",
      args: ["exec", "--yes", `--package=${archive}`, "--", packageJson.name, "mcp"],
      cwd: temporaryRoot,
      env: npmEnvironment,
      stderr: "pipe",
    });
    const client = new Client({ name: `armorial-registry-package-${label}`, version: "1.0.0" });
    await client.connect(transport);
    const connectMs = performance.now() - startedAt;
    try {
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name).sort(),
        ["browse_icons", "choose_icon", "get_icon", "get_icons", "resolve_icon", "search_icons"],
      );
      const result = await client.callTool({ name: "resolve_icon", arguments: { intent: "location" } });
      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent?.result?.icon?.id, "icon-park:local");
      return connectMs;
    } finally {
      await client.close();
    }
  }

  const coldConnectMs = await probe("cold");
  const warmConnectMs = await probe("warm");
  const unsafeHtmlPath = join(temporaryRoot, "script-pseudo-body.html");
  const unsafeHtml = '<!doctype html><html><head><script>const template = "<body>";</script></head></html>\n';
  writeFileSync(unsafeHtmlPath, unsafeHtml, "utf8");
  const unsafeInline = spawnSync("npm", [
    "exec",
    "--yes",
    `--package=${archive}`,
    "--",
    packageJson.name,
    "batch",
    "icon-park:search",
    "--inline-into",
    "script-pseudo-body.html",
  ], { cwd: temporaryRoot, env: npmEnvironment, encoding: "utf8" });
  assert.notEqual(unsafeInline.status, 0, unsafeInline.stderr);
  assert.equal(readFileSync(unsafeHtmlPath, "utf8"), unsafeHtml, "registry CLI must fail before mutation");

  const validHtmlPath = join(temporaryRoot, "valid-body.html");
  writeFileSync(validHtmlPath, '<!doctype html><html><body><svg><use href="#armorial-search"></use></svg></body></html>\n', "utf8");
  const validInline = JSON.parse(execFileSync("npm", [
    "exec",
    "--yes",
    `--package=${archive}`,
    "--",
    packageJson.name,
    "batch",
    "icon-park:search",
    "--inline-into",
    "valid-body.html",
  ], { cwd: temporaryRoot, env: npmEnvironment, encoding: "utf8" }));
  assert.equal(validInline.status, "ok");
  assert.equal(validInline.kind, "icon_sprite_inline");
  assert.equal(validInline.symbols, 1);
  assert.match(readFileSync(validHtmlPath, "utf8"), /<symbol id="armorial-search"/);
  process.stdout.write(`${JSON.stringify({
      status: "ok",
      package: `${packageJson.name}@${packageJson.version}`,
      server: serverJson.name,
      packageBytes: packed[0].size,
      unpackedBytes: packed[0].unpackedSize,
      coldNpmMcpConnectMs: Math.round(coldConnectMs * 100) / 100,
      warmNpmMcpConnectMs: Math.round(warmConnectMs * 100) / 100,
      invocation: `npx ${packageJson.name}@${packageJson.version} mcp`,
      resolved: "icon-park:local",
      inlineCarrier: "blocked-invalid+published-valid",
    })}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
