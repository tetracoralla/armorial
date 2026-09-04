import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type DevelopmentKind = "declaration" | "typescript-source" | "test-suite";

type PackageAddress = Readonly<{
  root: string;
  relative: string;
}>;

type RuntimeMatcher = Readonly<{
  target: string;
  matches: (path: string) => boolean;
}>;

export const IMMUTABLE_NODE_RUNTIME_CONDITIONS = [
  "node",
  "node-addons",
  "module-sync",
  "import",
  "require",
  "default",
] as const;

const immutableNodeRuntimeConditionSet = new Set<string>(IMMUTABLE_NODE_RUNTIME_CONDITIONS);

export type ThirdPartyPayloadAnalysis = Readonly<{
  thirdPartyEntries: number;
  thirdPartyDeclarationEntries: number;
  thirdPartyTypeScriptSourceEntries: number;
  thirdPartyTestSuiteEntries: number;
  thirdPartyProtectedDevelopmentEntries: number;
  thirdPartyProtectedDevelopmentPaths: readonly string[];
  thirdPartyRemovableDevelopmentEntries: number;
  removableDevelopmentPaths: readonly string[];
  runtimeTargetPaths: readonly string[];
  thirdPartyTestingHelperEntries: number;
  thirdPartyTestingHelperPaths: readonly string[];
}>;

function packageAddress(entry: string): PackageAddress | undefined {
  if (!entry.startsWith("./node_modules/")) return undefined;
  const components = entry.slice(2).split("/");
  const nodeModulesIndex = components.lastIndexOf("node_modules");
  const firstPackageComponent = components[nodeModulesIndex + 1];
  if (nodeModulesIndex < 0 || !firstPackageComponent) return undefined;
  const packageComponentCount = firstPackageComponent.startsWith("@") ? 2 : 1;
  const rootEnd = nodeModulesIndex + 1 + packageComponentCount;
  if (components.length < rootEnd || components.slice(nodeModulesIndex + 1, rootEnd).some((value) => !value)) return undefined;
  return {
    root: `./${components.slice(0, rootEnd).join("/")}`,
    relative: components.slice(rootEnd).join("/"),
  };
}

function developmentKind(path: string): DevelopmentKind | undefined {
  if (/\.d\.(?:ts|cts|mts)$/.test(path)) return "declaration";
  const segments = path.split("/");
  if (segments.some((segment) => /^(?:test|tests|__tests__|spec|specs|__specs__)$/i.test(segment))) return "test-suite";
  const name = segments.at(-1) ?? "";
  if (
    /(?:^|\.)(?:test|spec)\.[^.]+$/i.test(name)
    || /^tests?\.[cm]?js$/i.test(name)
    || /^test[-_.][^/]+$/i.test(name)
  ) return "test-suite";
  if (/\.(?:ts|tsx|cts|mts)$/.test(path)) return "typescript-source";
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runtimeMatcher(target: string): RuntimeMatcher | undefined {
  if (!target.startsWith("./")) return undefined;
  const normalized = target.slice(2).replaceAll("\\", "/");
  if (
    normalized === ""
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("/../")
    || /\.d\.(?:ts|cts|mts)$/.test(normalized)
  ) return undefined;
  if (normalized.includes("*")) {
    const expression = normalized.split("*").map(escapeRegExp).join("[^/]+?");
    return { target: normalized, matches: (path) => new RegExp(`^${expression}$`).test(path) };
  }
  if (normalized.endsWith("/")) {
    return { target: normalized, matches: (path) => path.startsWith(normalized) };
  }
  const hasExtension = /\.[^/]+$/.test(normalized);
  return {
    target: normalized,
    matches: hasExtension
      ? (path) => path === normalized
      : (path) => path === normalized
        || new RegExp(`^${escapeRegExp(normalized)}\\.(?:js|cjs|mjs|json|node)$`).test(path)
        || new RegExp(`^${escapeRegExp(normalized)}/index\\.(?:js|cjs|mjs|json|node)$`).test(path),
  };
}

function collectTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === "string") {
    if (runtimeMatcher(value) !== undefined) targets.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, targets);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (["types", "typings"].includes(key)) continue;
    collectTargets(item, targets);
  }
}

function collectConditionalRuntimeTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === "string" || Array.isArray(value)) {
    collectTargets(value, targets);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith(".") || key.startsWith("#") || immutableNodeRuntimeConditionSet.has(key)) {
      collectConditionalRuntimeTargets(item, targets);
    }
  }
}

function packageMatchers(directory: string, root: string): readonly RuntimeMatcher[] {
  const manifestPath = join(directory, root.slice(2), "package.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const targets = new Set<string>();
  for (const field of ["main", "module", "bin"] as const) {
    collectTargets(manifest[field], targets);
  }
  // The immutable carrier is launched by Agent Host's Node runtime. Preserve
  // only Node's production resolution branches; opt-in source, types,
  // development, browser, Deno, and Bun conditions are not active carriers.
  collectConditionalRuntimeTargets(manifest.exports, targets);
  collectConditionalRuntimeTargets(manifest.imports, targets);
  return [...targets].map(runtimeMatcher).filter((value): value is RuntimeMatcher => value !== undefined);
}

export function analyzeThirdPartyPayload(directory: string, entries: readonly string[]): ThirdPartyPayloadAnalysis {
  const thirdParty = entries.filter((entry) => entry.startsWith("./node_modules/"));
  const matchers = new Map<string, readonly RuntimeMatcher[]>();
  const declarationPaths: string[] = [];
  const typeScriptSourcePaths: string[] = [];
  const testSuitePaths: string[] = [];
  const protectedDevelopmentPaths: string[] = [];
  const removableDevelopmentPaths: string[] = [];
  const runtimeTargetPaths: string[] = [];
  const testingHelperPaths: string[] = [];

  for (const entry of thirdParty) {
    const address = packageAddress(entry);
    if (address === undefined || address.relative === "") continue;
    let packageRuntimeMatchers = matchers.get(address.root);
    if (packageRuntimeMatchers === undefined) {
      packageRuntimeMatchers = packageMatchers(directory, address.root);
      matchers.set(address.root, packageRuntimeMatchers);
    }
    const kind = developmentKind(address.relative);
    // Broad subpath export patterns can lexically match declaration or source
    // map companions even though Node never executes them. Only executable
    // targets participate in the preservation set.
    const protectedRuntime = kind !== "declaration"
      && !address.relative.endsWith(".map")
      && packageRuntimeMatchers.some((matcher) => matcher.matches(address.relative));
    if (protectedRuntime) runtimeTargetPaths.push(entry);
    if (/(^|\/)helper\/testing(?:\/|$)/.test(address.relative)) testingHelperPaths.push(entry);
    if (kind === undefined) continue;
    if (kind === "declaration") declarationPaths.push(entry);
    else if (kind === "typescript-source") typeScriptSourcePaths.push(entry);
    else testSuitePaths.push(entry);
    if (protectedRuntime) protectedDevelopmentPaths.push(entry);
    else removableDevelopmentPaths.push(entry);
  }

  for (const list of [
    declarationPaths,
    typeScriptSourcePaths,
    testSuitePaths,
    protectedDevelopmentPaths,
    removableDevelopmentPaths,
    runtimeTargetPaths,
    testingHelperPaths,
  ]) list.sort();

  return {
    thirdPartyEntries: thirdParty.length,
    thirdPartyDeclarationEntries: declarationPaths.length,
    thirdPartyTypeScriptSourceEntries: typeScriptSourcePaths.length,
    thirdPartyTestSuiteEntries: testSuitePaths.length,
    thirdPartyProtectedDevelopmentEntries: protectedDevelopmentPaths.length,
    thirdPartyProtectedDevelopmentPaths: protectedDevelopmentPaths,
    thirdPartyRemovableDevelopmentEntries: removableDevelopmentPaths.length,
    removableDevelopmentPaths,
    runtimeTargetPaths,
    thirdPartyTestingHelperEntries: testingHelperPaths.length,
    thirdPartyTestingHelperPaths: testingHelperPaths,
  };
}
