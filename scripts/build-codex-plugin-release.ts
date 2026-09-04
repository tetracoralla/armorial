import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { analyzeThirdPartyPayload, IMMUTABLE_NODE_RUNTIME_CONDITIONS } from "./third-party-runtime-payload.js";

const workspace = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(process.env.ARMORIAL_RELEASE_DIRECTORY ?? join(workspace, ".release"));
const runtimeGuide = join(workspace, "docs", "CODEX_PLUGIN_RUNTIME.md");
const requiredRuntimeFiles = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/icon-svg-select/SKILL.md",
  "dist/adapters/cli.js",
  "dist/adapters/publication-contract.js",
  "dist/adapters/publish-helper.js",
  "dist/adapters/mcp.js",
  "dist/adapters/main-module.js",
  "dist/adapters/policy-file.js",
  "dist/adapters/presentation.js",
  "dist/version.js",
  "dist/mcp-app/index.html",
  "icon-policy.schema.json",
  "icon-policy.example.json",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "SBOM.spdx.json",
  "RUNTIME.md",
];

function assertMacOsArm64(): void {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("The immutable Armorial plugin archive must be built on macOS arm64.");
  }
}

function assertInside(path: string, parent: string): void {
  const rel = relative(parent, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${"/"}`) || rel.includes(`..${"/"}`)) {
    throw new Error(`Refusing path outside its owned parent: ${path}`);
  }
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function remove(path: string, ownedParent: string): void {
  assertInside(path, ownedParent);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

function listTree(directory: string): string[] {
  return run("find", [".", "-type", "f", "-o", "-type", "l"], directory)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function summarizeRuntimeTree(directory: string) {
  const entries = listTree(directory);
  return {
    entries: entries.length,
    unpackedBytes: entries.reduce((sum, entry) => sum + lstatSync(join(directory, entry.slice(2))).size, 0),
    ...analyzeThirdPartyPayload(directory, entries),
  };
}

function pruneThirdPartyDevelopmentPayload(directory: string): void {
  const analysis = analyzeThirdPartyPayload(directory, listTree(directory));
  for (const entry of analysis.removableDevelopmentPaths) {
    remove(join(directory, entry.slice(2)), join(directory, "node_modules"));
  }
  removeEmptyDirectories(join(directory, "node_modules"));
}

function writeRuntimePackageJson(directory: string): void {
  const source = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
    name: string;
    version: string;
    description: string;
    license: string;
    author: unknown;
    dependencies: Record<string, string>;
  };
  const manifest = JSON.parse(readFileSync(join(directory, ".codex-plugin", "plugin.json"), "utf8")) as {
    name: string;
    version: string;
  };
  if (source.name !== "armorial" || manifest.name !== source.name || manifest.version !== source.version) {
    throw new Error("Package and Codex plugin identities must remain identical in the immutable archive.");
  }
  writeFileSync(join(directory, "package.json"), `${JSON.stringify({
    name: source.name,
    version: source.version,
    description: source.description,
    license: source.license,
    author: source.author,
    type: "module",
    private: true,
    dependencies: source.dependencies,
  }, null, 2)}\n`, "utf8");
}

function writePluginNotices(directory: string): void {
  const source = readFileSync(join(directory, "THIRD_PARTY_NOTICES.md"), "utf8");
  const introduction = "Armorial's macOS arm64 Codex plugin distribution includes the production packages and bundled MCP App modules below. This inventory is generated from the exact production dependency tree and the packaged build manifests.";
  const rewritten = source.replace(
    /Armorial's installable package, browser surface, MCP App, and Figma distribution depend on or bundle the packages below\. This inventory is generated from the installed production dependency tree and Vite's exact module manifests for the packaged builds\./,
    introduction,
  );
  if (rewritten === source) throw new Error("Could not rewrite the plugin-specific third-party notice introduction.");
  writeFileSync(join(directory, "THIRD_PARTY_NOTICES.md"), rewritten, "utf8");
  writeFileSync(join(directory, "NOTICE"), [
    "Armorial Codex plugin",
    "Copyright 2026 openAdam",
    "",
    "This plugin includes software developed by openAdam and contributors",
    "(https://github.com/tetracoralla/armorial).",
    "",
    "This plugin includes and renders geometry from @icon-park/svg",
    "(https://github.com/bytedance/IconPark), which is Copyright ByteDance Inc.",
    "and licensed under the Apache License, Version 2.0.",
    "",
    "Complete third-party license text for this plugin payload is included in",
    "THIRD_PARTY_NOTICES.md and its SPDX inventory is SBOM.spdx.json.",
    "",
  ].join("\n"), "utf8");
}

function assertNoNativeAddons(directory: string): void {
  const native = listTree(join(directory, "node_modules")).filter((path) => path.endsWith(".node"));
  if (native.length > 0) throw new Error(`The host-bound plugin must not ship native addons: ${native.join(", ")}`);
}

/** npm may retain empty scope directories for omitted development packages. */
function removeEmptyDirectories(directory: string): boolean {
  for (const name of readdirSync(directory)) {
    const child = join(directory, name);
    const status = lstatSync(child);
    if (status.isDirectory() && !status.isSymbolicLink()) removeEmptyDirectories(child);
  }
  if (readdirSync(directory).length === 0) {
    rmdirSync(directory);
    return true;
  }
  return false;
}

function pruneToPluginRuntime(directory: string): void {
  const dist = join(directory, "dist");
  const adapters = join(dist, "adapters");
  remove(join(adapters, "web-server.js"), adapters);
  for (const name of ["cli.d.ts", "web-server.d.ts", "mcp.d.ts", "main-module.d.ts", "policy-file.d.ts", "presentation.d.ts"]) {
    remove(join(adapters, name), adapters);
  }
  remove(join(dist, "index.js"), dist);
  remove(join(dist, "index.d.ts"), dist);
  remove(join(dist, "web"), dist);
  remove(join(directory, "figma-plugin"), directory);
  remove(join(directory, "README.md"), directory);
  for (const name of ["package-lock.json", ".npmrc"]) remove(join(directory, name), directory);
  remove(join(directory, "node_modules", ".bin"), join(directory, "node_modules"));
  remove(join(directory, "node_modules", ".package-lock.json"), join(directory, "node_modules"));
  pruneThirdPartyDevelopmentPayload(directory);
  removeEmptyDirectories(join(directory, "node_modules"));
  for (const entry of listTree(directory)) {
    if (/\.d\.(?:ts|cts|mts)$/.test(entry) || entry.endsWith(".map")) {
      remove(join(directory, entry.slice(2)), directory);
    }
  }
  removeEmptyDirectories(join(directory, "node_modules"));
}

function assertMinimalPluginTree(directory: string): void {
  for (const file of requiredRuntimeFiles) {
    if (!existsSync(join(directory, file))) throw new Error(`Immutable plugin payload is missing ${file}.`);
  }
  for (const forbidden of ["src", "test", "figma-plugin", "dist/web", "README.md", "package-lock.json", "node_modules/.bin", "node_modules/.package-lock.json"]) {
    if (existsSync(join(directory, forbidden))) throw new Error(`Immutable plugin payload unexpectedly contains ${forbidden}.`);
  }
  const emptyDirectories = run("find", ["node_modules", "-mindepth", "1", "-maxdepth", "1", "-type", "d", "-empty", "-print"], directory)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (emptyDirectories.length > 0) throw new Error(`Empty omitted-dependency directories escaped pruning: ${emptyDirectories.join(", ")}`);
  for (const entry of listTree(directory)) {
    if (/\.d\.(?:ts|cts|mts)$/.test(entry) || entry.endsWith(".map")) throw new Error(`Development residue escaped plugin pruning: ${entry}`);
  }
  const summary = summarizeRuntimeTree(directory);
  if (summary.thirdPartyRemovableDevelopmentEntries !== 0) {
    throw new Error(`Third-party development payload escaped plugin pruning: ${JSON.stringify(summary)}`);
  }
  const dependencyTree = JSON.parse(run("npm", ["ls", "--omit=dev", "--all", "--json"], directory)) as { problems?: string[] };
  if ((dependencyTree.problems ?? []).length > 0) throw new Error(`Invalid production dependency tree: ${dependencyTree.problems?.join(", ")}`);
  assertNoNativeAddons(directory);
}

function writeSbom(directory: string): void {
  const sbom = JSON.parse(run("npm", ["sbom", "--omit=dev", "--sbom-format", "spdx", "--json"], directory)) as {
    spdxVersion?: unknown;
    packages?: unknown[];
  };
  if (sbom.spdxVersion !== "SPDX-2.3" || !Array.isArray(sbom.packages) || sbom.packages.length === 0) {
    throw new Error("npm did not produce a populated SPDX 2.3 SBOM for the immutable plugin.");
  }
  writeFileSync(join(directory, "SBOM.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
}

function ensureOutputDirectory(): void {
  if (existsSync(outputDirectory)) {
    if (!lstatSync(outputDirectory).isDirectory()) throw new Error(`Release output path is not a directory: ${outputDirectory}`);
  } else {
    mkdirSync(outputDirectory, { recursive: true });
  }
}

assertMacOsArm64();
ensureOutputDirectory();
const packageJson = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as { name: string; version: string };
if (packageJson.name !== "armorial") throw new Error("Expected the Armorial package identity.");
const temporaryRoot = mkdtempSync(join(tmpdir(), "armorial-immutable-release-"));
const packDirectory = join(temporaryRoot, "pack");
const unpackDirectory = join(temporaryRoot, "armorial");
mkdirSync(packDirectory);
mkdirSync(unpackDirectory);

try {
  run("npm", ["pack", "--pack-destination", packDirectory], workspace);
  const packContents = run("find", [".", "-maxdepth", "1", "-name", "*.tgz", "-print"], packDirectory)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (packContents.length !== 1) throw new Error(`Expected one npm package tarball, found ${packContents.length}.`);
  const npmTarball = join(packDirectory, basename(packContents[0]!));
  run("tar", ["-xzf", npmTarball, "-C", unpackDirectory, "--strip-components=1"], temporaryRoot);
  const pluginDirectory = unpackDirectory;
  copyFileSync(join(workspace, "package-lock.json"), join(pluginDirectory, "package-lock.json"));
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], pluginDirectory);
  // npm sbom validates the current root manifest even with --omit=dev. Narrow
  // that manifest before generating the runtime-only inventory so omitted test
  // tooling cannot appear as a missing dependency or in the SBOM itself.
  writeRuntimePackageJson(pluginDirectory);
  writeSbom(pluginDirectory);
  copyFileSync(runtimeGuide, join(pluginDirectory, "RUNTIME.md"));
  writePluginNotices(pluginDirectory);
  const beforePruning = summarizeRuntimeTree(pluginDirectory);
  pruneToPluginRuntime(pluginDirectory);
  assertMinimalPluginTree(pluginDirectory);
  const runtimeTree = summarizeRuntimeTree(pluginDirectory);
  if (JSON.stringify(runtimeTree.runtimeTargetPaths) !== JSON.stringify(beforePruning.runtimeTargetPaths)) {
    throw new Error("Third-party package runtime targets changed during immutable payload pruning.");
  }

  const archiveBaseName = `armorial-${packageJson.version}-codex-plugin-macos-arm64`;
  const temporaryArchive = join(temporaryRoot, `${archiveBaseName}.tar.gz`);
  execFileSync("tar", ["-czf", temporaryArchive, "-C", temporaryRoot, "armorial"], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: "ignore",
  });
  const archivePath = join(outputDirectory, `${archiveBaseName}.tar.gz`);
  const checksumPath = `${archivePath}.sha256`;
  const archiveTempPath = `${archivePath}.tmp-${process.pid}`;
  copyFileSync(temporaryArchive, archiveTempPath);
  renameSync(archiveTempPath, archivePath);
  const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  writeFileSync(checksumPath, `${digest}  ${basename(archivePath)}\n`, "utf8");
  const artifactSize = statSync(archivePath).size;
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    artifact: archivePath,
    checksum: checksumPath,
    sha256: digest,
    bytes: artifactSize,
    package: `${packageJson.name}@${packageJson.version}`,
    target: "macos-arm64",
    runtime: "Agent Host-provided node",
    packageReport: {
      archiveBytes: artifactSize,
      entries: runtimeTree.entries,
      unpackedBytes: runtimeTree.unpackedBytes,
      thirdPartyEntries: runtimeTree.thirdPartyEntries,
      thirdPartyDeclarationEntries: runtimeTree.thirdPartyDeclarationEntries,
      thirdPartyTypeScriptSourceEntries: runtimeTree.thirdPartyTypeScriptSourceEntries,
      thirdPartyTestSuiteEntries: runtimeTree.thirdPartyTestSuiteEntries,
      thirdPartyProtectedDevelopmentEntries: runtimeTree.thirdPartyProtectedDevelopmentEntries,
      thirdPartyProtectedDevelopmentPaths: runtimeTree.thirdPartyProtectedDevelopmentPaths,
      thirdPartyRemovableDevelopmentEntries: runtimeTree.thirdPartyRemovableDevelopmentEntries,
      thirdPartyRuntimeTargetEntries: runtimeTree.runtimeTargetPaths.length,
      thirdPartyRuntimeConditions: IMMUTABLE_NODE_RUNTIME_CONDITIONS,
      thirdPartyTestingHelperEntries: runtimeTree.thirdPartyTestingHelperEntries,
      thirdPartyTestingHelperPaths: runtimeTree.thirdPartyTestingHelperPaths,
      prunedThirdPartyDeclarationEntries: beforePruning.thirdPartyDeclarationEntries - runtimeTree.thirdPartyDeclarationEntries,
      prunedThirdPartyTypeScriptSourceEntries: beforePruning.thirdPartyTypeScriptSourceEntries - runtimeTree.thirdPartyTypeScriptSourceEntries,
      prunedThirdPartyTestSuiteEntries: beforePruning.thirdPartyTestSuiteEntries - runtimeTree.thirdPartyTestSuiteEntries,
      prunedThirdPartyDevelopmentEntries: beforePruning.thirdPartyRemovableDevelopmentEntries - runtimeTree.thirdPartyRemovableDevelopmentEntries,
      firstPartySourceEntries: 0,
      firstPartyTestEntries: 0,
      productionTestHooks: 0,
    },
  })}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
