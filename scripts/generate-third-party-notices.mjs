import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const figmaNoticesPath = resolve(root, "figma-plugin/THIRD_PARTY_NOTICES.txt");
const rootNoticesPath = resolve(root, "THIRD_PARTY_NOTICES.md");
// License manifests come from the ARMORIAL_LICENSE_SCAN builds only; the
// publishable dist directories never carry them.
const webManifest = resolve(root, ".license-build/web/.vite/licenses.json");
const mcpAppManifest = resolve(root, ".license-build/mcp-app/.vite/licenses.json");
const figmaUiManifest = resolve(root, ".license-build/figma-ui/.vite/licenses.json");
const figmaMainManifest = resolve(root, ".license-build/figma-main/.vite/licenses.json");
const figmaManifests = [figmaUiManifest, figmaMainManifest];
const rootManifests = [webManifest, mcpAppManifest, ...figmaManifests];

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function loadManifest(path) {
  if (!existsSync(path)) {
    throw new Error(
      `License manifest not found: ${path}\n`
      + "Run `npm run build:license-manifests` before generating or checking third-party notices.",
    );
  }
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(value)) throw new Error(`Invalid Vite license manifest: ${path}`);
  for (const entry of value) {
    if (
      typeof entry !== "object" || entry === null ||
      typeof entry.name !== "string" || entry.name.length === 0 ||
      typeof entry.version !== "string" || entry.version.length === 0 ||
      typeof entry.identifier !== "string" || entry.identifier.length === 0 ||
      typeof entry.text !== "string" || entry.text.trim().length === 0
    ) {
      throw new Error(`Incomplete bundled license entry in ${path}`);
    }
  }
  return value;
}

function loadInstalledPackage(directory) {
  const metadata = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
  const legalFileName = readdirSync(directory)
    .filter((fileName) => /^(licen[cs]e|copying)(?:[._-]|$)/i.test(fileName))
    .sort(compareCodeUnits)[0];
  const text = legalFileName
    ? readFileSync(resolve(directory, legalFileName), "utf8").trim()
    : "";
  if (
    typeof metadata.name !== "string" || metadata.name.length === 0 ||
    typeof metadata.version !== "string" || metadata.version.length === 0 ||
    typeof metadata.license !== "string" || text.length === 0
  ) {
    throw new Error(`Incomplete production dependency license metadata in ${directory}`);
  }
  return {
    name: metadata.name,
    version: metadata.version,
    identifier: metadata.license,
    text,
  };
}

function loadProductionDependencyDirectories() {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : "npm";
  const args = npmExecPath
    ? [npmExecPath, "ls", "--omit=dev", "--all", "--parseable", "--json=false"]
    : ["ls", "--omit=dev", "--all", "--parseable", "--json=false"];
  const stdout = execFileSync(command, args, { cwd: root, encoding: "utf8" });
  return stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter((path) => path.length > 0 && resolve(path) !== root)
    .sort(compareCodeUnits);
}

function createPackageMap() {
  const packageMap = new Map();
  return {
    add(entry) {
      const key = `${entry.name}@${entry.version}`;
      const normalized = {
        name: entry.name,
        version: entry.version,
        declaredLicense: entry.identifier,
        text: entry.text
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => line.replace(/[ \t]+$/g, ""))
          .join("\n")
          .trim(),
      };
      const prior = packageMap.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) {
        throw new Error(`Conflicting bundled license metadata for ${key}`);
      }
      packageMap.set(key, normalized);
    },
    sections() {
      return [...packageMap.values()].sort((left, right) =>
        compareCodeUnits(`${left.name}@${left.version}`, `${right.name}@${right.version}`));
    },
    size() {
      return packageMap.size;
    },
  };
}

const rootPackages = createPackageMap();
for (const directory of loadProductionDependencyDirectories()) {
  rootPackages.add(loadInstalledPackage(directory));
}
for (const path of rootManifests) {
  for (const entry of loadManifest(path)) rootPackages.add(entry);
}
if (rootPackages.size() === 0) throw new Error("No production or bundled dependencies were found");

// The Figma distribution ships only what its two bundles actually embed; its
// notices stay exact instead of inheriting the full installable union.
const figmaPackages = createPackageMap();
for (const path of figmaManifests) {
  for (const entry of loadManifest(path)) figmaPackages.add(entry);
}
if (figmaPackages.size() === 0) throw new Error("No Figma-bundled dependencies were found");

function renderNotices(packages, introduction) {
  const sections = packages.map((item) => [
    `## ${item.name}@${item.version}`,
    "",
    `Declared license: ${item.declaredLicense}`,
    "",
    "### License text",
    "",
    item.text,
  ].join("\n"));
  return [
    "# Third-party notices",
    "",
    introduction,
    "",
    ...sections,
    "",
  ].join("\n");
}

const outputs = [
  {
    path: rootNoticesPath,
    content: renderNotices(
      rootPackages.sections(),
      "Armorial's installable package, browser surface, MCP App, and Figma distribution depend on or bundle the packages below. This inventory is generated from the installed production dependency tree and Vite's exact module manifests for the packaged builds.",
    ),
  },
  {
    path: figmaNoticesPath,
    content: renderNotices(
      figmaPackages.sections(),
      "The Armorial Figma plugin bundles the packages below. This inventory is generated from Vite's exact module manifests for the plugin's main-thread and UI builds.",
    ),
  },
];

if (process.argv.includes("--check")) {
  for (const output of outputs) {
    let current = "";
    try {
      current = readFileSync(output.path, "utf8");
    } catch {
      // Report missing output through the same drift error.
    }
    if (current !== output.content) {
      process.stderr.write(`third-party notices are stale for ${output.path}; run npm run generate:licenses\n`);
      process.exit(1);
    }
  }
} else {
  for (const output of outputs) writeFileSync(output.path, output.content, "utf8");
  process.stdout.write("third-party notices generated\n");
}
