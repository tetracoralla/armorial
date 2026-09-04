import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    "CHANGELOG.md",
    "server.json",
    "dist/adapters/cli.js",
    "dist/adapters/publication-contract.js",
    "dist/adapters/publish-helper.js",
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
  for (const [fileName, unsafeHtml] of new Map([
    ["script-pseudo-body.html", '<!doctype html><html><head><script>const template = "<body>";</script></head></html>\n'],
    ["head-marker-block.html", "<!doctype html><html><head><!-- armorial:sprite:start --><!-- armorial:sprite:end --></head><body><main>keep</main></body></html>\n"],
  ])) {
    const unsafeHtmlPath = join(temporaryRoot, fileName);
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
      fileName,
      "--allow-optimistic-overwrite",
    ], { cwd: temporaryRoot, env: npmEnvironment, encoding: "utf8" });
    assert.equal(unsafeInline.status, 2, unsafeInline.stderr);
    assert.equal(unsafeInline.stdout, "");
    assert.equal(JSON.parse(unsafeInline.stderr).error.code, "INVALID_INPUT");
    assert.equal(readFileSync(unsafeHtmlPath, "utf8"), unsafeHtml, "registry CLI must fail before mutation");
  }

  const validHtmlPath = join(temporaryRoot, "valid-body.html");
  const validCandidatePath = join(temporaryRoot, "valid-body.armorial.html");
  const validSource = '<!doctype html><html><body><svg><use href="#armorial-search"></use></svg></body></html>\n';
  writeFileSync(validHtmlPath, validSource, "utf8");
  const validInline = JSON.parse(execFileSync("npm", [
    "exec",
    "--yes",
    `--package=${archive}`,
    "--",
    packageJson.name,
    "batch",
    "icon-park:search",
    "--inline-from",
    "valid-body.html",
    "--output",
    "valid-body.armorial.html",
  ], { cwd: temporaryRoot, env: npmEnvironment, encoding: "utf8" }));
  assert.equal(validInline.status, "ok");
  assert.equal(validInline.kind, "icon_sprite_inline_candidate");
  assert.equal(validInline.protectionLevel, "non_overwriting_candidate");
  assert.equal(validInline.symbols, 1);
  assert.equal(readFileSync(validHtmlPath, "utf8"), validSource);
  assert.match(readFileSync(validCandidatePath, "utf8"), /<symbol id="armorial-search"/);
  const installedPackageRoot = join(temporaryRoot, "installed-package");
  mkdirSync(installedPackageRoot);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], {
    cwd: installedPackageRoot,
    env: npmEnvironment,
    stdio: "ignore",
  });
  const resourceObservation = JSON.parse(execFileSync(process.execPath, [
    join(workspace, "scripts/probe-inline-resource.mjs"),
    "--module",
    join(installedPackageRoot, "node_modules", packageJson.name, "dist/adapters/cli-artifact.js"),
  ], { encoding: "utf8" }));
  assert.equal(resourceObservation.status, "ok");
  assert.equal(resourceObservation.observations.length, 4);
  const candidateObservation = JSON.parse(execFileSync(process.execPath, [
    join(workspace, "scripts/probe-inline-candidate.mjs"),
    "--cli",
    join(installedPackageRoot, "node_modules", packageJson.name, "dist/adapters/cli.js"),
  ], { encoding: "utf8" }));
  assert.equal(candidateObservation.status, "ok");
  assert.equal(candidateObservation.outputRace, "INVALID_INPUT+competing-output-preserved");
  assert.equal(candidateObservation.hardLinkRace, "INVALID_INPUT+source-alias-preserved");
  assert.equal(candidateObservation.optimistic.length, 2);
  const pinObservation = JSON.parse(execFileSync(process.execPath, [
    join(workspace, "scripts/probe-pinned-publication.mjs"),
    "--cli",
    join(installedPackageRoot, "node_modules", packageJson.name, "dist/adapters/cli.js"),
  ], { encoding: "utf8" }));
  assert.equal(pinObservation.status, "ok");
  assert.equal(pinObservation.swaps.length, 6);
  assert.equal(pinObservation.helperFailures.length, 8);
  assert.equal(pinObservation.publicationSuccesses.length, 4);
  assert.equal(pinObservation.postCommitCleanupWarnings.length, 2);
  assert.equal(pinObservation.postCommitInterruptions.length, 8);
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
    join(installedPackageRoot, "node_modules", packageJson.name, "dist/adapters/cli.js"),
  ], { encoding: "utf8" }));
  assert.equal(basenameObservation.status, "ok");
  assert.equal(basenameObservation.observations.length, 24);
  const cancellationObservation = JSON.parse(execFileSync(process.execPath, [
    join(workspace, "scripts/probe-publish-parent-cancellation.mjs"),
    "--cli",
    join(installedPackageRoot, "node_modules", packageJson.name, "dist/adapters/cli.js"),
    "--deadline",
  ], { encoding: "utf8" }));
  assert.equal(cancellationObservation.status, "ok");
  assert.equal(cancellationObservation.cancellation.length, 4);
  assert.equal(cancellationObservation.deadline, "bounded-before-commit+no-final-effect");
  assert.deepEqual(cancellationObservation.cleanupRevocation, {
    status: "deadline-cause+cleanup-failure+private-complete-residue",
    effect: "none",
    cleanup: "failed",
    mode: "0600",
  });
  const transitionObservation = JSON.parse(execFileSync(process.execPath, [
    join(workspace, "scripts/probe-inline-transition.mjs"),
    "--cli",
    join(installedPackageRoot, "node_modules", packageJson.name, "dist/adapters/cli.js"),
  ], { encoding: "utf8" }));
  assert.equal(transitionObservation.status, "ok");
  assert.equal(transitionObservation.transition.overLimit, "INVALID_INPUT");
  assert.ok(transitionObservation.transition.firstBytes > transitionObservation.contract.callerBytes);
  assert.ok(transitionObservation.transition.replacementBytes > transitionObservation.contract.callerBytes);
  const conflictObservation = JSON.parse(execFileSync(process.execPath, [
    join(workspace, "scripts/probe-inline-conflict.mjs"),
    "--cli",
    join(installedPackageRoot, "node_modules", packageJson.name, "dist/adapters/cli.js"),
  ], { encoding: "utf8" }));
  assert.equal(conflictObservation.status, "ok");
  assert.deepEqual(conflictObservation.observations.map(({ method, code, residue }) => ({ method, code, residue })), [
    { method: "in-place", code: "INVALID_INPUT", residue: 0 },
    { method: "replace", code: "INVALID_INPUT", residue: 0 },
  ]);
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
      inlineCarrier: "safe-candidate+pinned-parent+precommit-cancellation+output-race-preserved+optimistic-window-disclosed+blocked-invalid+max-retry-replace+bounded-resource",
    })}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
