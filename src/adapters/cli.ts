#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { KERNEL_VERSION } from "../version.js";
import { IconKernelError, toKernelError } from "../core/errors.js";
import { isMainModule } from "./main-module.js";

type Format = "json" | "text" | "svg" | "sprite";

const SYMBOL_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const MAX_INLINE_HTML_BYTES = 8 * 1024 * 1024;
const SPRITE_START_MARKER = "<!-- armorial:sprite:start -->";
const SPRITE_END_MARKER = "<!-- armorial:sprite:end -->";

type ResolvedIntent = Readonly<{ intent: string; id: string }>;
type UnresolvedIntent = Readonly<{
  index: number;
  intent: string;
  code: string;
  message: string;
  candidates?: readonly string[];
}>;

const HELP = `armorial ${KERNEL_VERSION}

Usage:
  armorial mcp [--policy file]
  armorial search <query...> [--limit 8] [--format text|json] [--policy file]
  armorial resolve <intent...> [--context name] [--alternatives 3] [--format json|text|svg] [--policy file]
  armorial get <icon-id> [--context name] [--format json|svg] [--policy file]
  armorial batch <icon-id...> [--context name] [--format json|text|sprite] [--symbol-prefix text] [--output relative.svg | --inline-into relative.html] [--allow-symbol-removal] [--policy file]
  armorial batch <intent...> --resolve-intents [--context name] [--symbol-prefix text] (--output relative.svg | --inline-into relative.html) [--allow-symbol-removal] [--policy file]
  armorial policy validate <file>
  armorial policy schema

Policy resolution order: --policy file, $ICON_SVG_SELECT_POLICY, ./icon-policy.json, built-in default.

The CLI writes results to stdout unless an explicit task-local --output or --inline-into path is used with --format sprite.`;

function asInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
}

function parseFormat(value: string | undefined, allowed: readonly Format[], fallback: Format): Format {
  const format = value ?? fallback;
  if (!allowed.includes(format as Format)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `Unsupported format "${format}". Use ${allowed.join(" or ")}.`,
      field: "format",
    });
  }
  return format as Format;
}

async function createKernel(policyPath?: string) {
  const [{ IconKernel }, { resolvePolicyInput }] = await Promise.all([
    import("../core/kernel.js"),
    import("./policy-file.js"),
  ]);
  return new IconKernel(await resolvePolicyInput(policyPath));
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeText(value: string): void {
  process.stdout.write(`${value}\n`);
}

function writeFailure(value: unknown): void {
  process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = 2;
}

function pathIsInside(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
}

async function writeSpriteFile(
  outputPath: string,
  sprite: string,
  symbolCount: number,
  resolved?: readonly ResolvedIntent[],
): Promise<void> {
  if (isAbsolute(outputPath) || !outputPath.toLowerCase().endsWith(".svg")) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output must be a relative .svg path inside the current working directory.",
      field: "output",
    });
  }

  const logicalDestination = resolve(process.cwd(), outputPath);
  let workingRoot: string;
  let parentRoot: string;
  try {
    [workingRoot, parentRoot] = await Promise.all([
      realpath(process.cwd()),
      realpath(dirname(logicalDestination)),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "output parent directory must already exist.",
        field: "output",
      });
    }
    throw error;
  }
  if (!pathIsInside(workingRoot, parentRoot)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output must remain inside the current working directory and cannot traverse a symlink outside it.",
      field: "output",
    });
  }

  const destination = join(parentRoot, basename(logicalDestination));
  try {
    const current = await lstat(destination);
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "output may replace only a regular file.",
        field: "output",
      });
    }
  } catch (error) {
    if (error instanceof IconKernelError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const serialized = `${sprite}\n`;
  const temporary = join(parentRoot, `.${basename(destination)}.armorial-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }

  writeJson({
    status: "ok",
    kind: "icon_sprite_file",
    output: relative(workingRoot, destination) || basename(destination),
    bytes: Buffer.byteLength(serialized),
    sha256: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    symbols: symbolCount,
    ...(resolved === undefined ? {} : { resolved }),
  });
}

async function resolveExistingTaskFile(inputPath: string, extension: RegExp, field: string): Promise<{
  workingRoot: string;
  destination: string;
}> {
  if (isAbsolute(inputPath) || !extension.test(inputPath)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} must be a relative ${field === "inline-into" ? ".html or .htm" : ".svg"} path inside the current working directory.`,
      field,
    });
  }

  const logicalDestination = resolve(process.cwd(), inputPath);
  let workingRoot: string;
  let parentRoot: string;
  try {
    [workingRoot, parentRoot] = await Promise.all([
      realpath(process.cwd()),
      realpath(dirname(logicalDestination)),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `${field} parent directory must already exist.`,
        field,
      });
    }
    throw error;
  }
  if (!pathIsInside(workingRoot, parentRoot)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} must remain inside the current working directory and cannot traverse a symlink outside it.`,
      field,
    });
  }

  const destination = join(parentRoot, basename(logicalDestination));
  let current;
  try {
    current = await lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `${field} must name an existing regular file.`,
        field,
      });
    }
    throw error;
  }
  if (!current.isFile() || current.isSymbolicLink()) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} must name an existing regular file.`,
      field,
    });
  }
  return { workingRoot, destination };
}

async function replaceFileAtomically(destination: string, serialized: string): Promise<void> {
  const temporary = join(dirname(destination), `.${basename(destination)}.armorial-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function inlineSpriteIntoHtml(
  inputPath: string,
  sprite: string,
  symbolCount: number,
  resolved?: readonly ResolvedIntent[],
  allowSymbolRemoval = false,
): Promise<void> {
  const { workingRoot, destination } = await resolveExistingTaskFile(inputPath, /\.html?$/i, "inline-into");
  const original = await readFile(destination, "utf8");
  if (Buffer.byteLength(original) > MAX_INLINE_HTML_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `inline-into HTML must not exceed ${MAX_INLINE_HTML_BYTES} bytes.`,
      field: "inline-into",
    });
  }

  const starts = original.split(SPRITE_START_MARKER).length - 1;
  const ends = original.split(SPRITE_END_MARKER).length - 1;
  if (starts !== ends || starts > 1) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline-into HTML contains an incomplete or duplicate Armorial sprite block.",
      field: "inline-into",
    });
  }

  const block = `${SPRITE_START_MARKER}\n${sprite}\n${SPRITE_END_MARKER}`;
  let serialized: string;
  if (starts === 1) {
    const start = original.indexOf(SPRITE_START_MARKER);
    const end = original.indexOf(SPRITE_END_MARKER, start) + SPRITE_END_MARKER.length;
    const previousBlock = original.slice(start, end);
    const previousSymbols = [...previousBlock.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]!);
    const nextSymbols = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]!));
    const removedSymbols = previousSymbols.filter((id) => !nextSymbols.has(id));
    if (removedSymbols.length > 0 && !allowSymbolRemoval) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `inline-into would remove ${removedSymbols.length} existing Armorial symbols (${removedSymbols.slice(0, 8).join(", ")}${removedSymbols.length > 8 ? ", …" : ""}); rerun with the complete union or pass --allow-symbol-removal after confirming they are unused.`,
        field: "inline-into",
      });
    }
    const lineStart = original.lastIndexOf("\n", start - 1) + 1;
    const indentation = original.slice(lineStart, start);
    if (!/^\s*$/.test(indentation)) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "inline-into Armorial sprite marker must start on its own line.",
        field: "inline-into",
      });
    }
    serialized = `${original.slice(0, start)}${block.replaceAll("\n", `\n${indentation}`)}${original.slice(end)}`;
  } else {
    const bodyTags = [...original.matchAll(/<body(?:\s[^>]*)?>/gi)];
    if (bodyTags.length !== 1 || bodyTags[0]?.index === undefined) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "inline-into HTML must contain exactly one body opening tag.",
        field: "inline-into",
      });
    }
    const insertion = bodyTags[0].index + bodyTags[0][0].length;
    serialized = `${original.slice(0, insertion)}\n  ${block.replaceAll("\n", "\n  ")}\n${original.slice(insertion)}`;
  }

  await replaceFileAtomically(destination, serialized);
  writeJson({
    status: "ok",
    kind: "icon_sprite_inline",
    output: relative(workingRoot, destination) || basename(destination),
    bytes: Buffer.byteLength(serialized),
    sha256: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    symbols: symbolCount,
    ...(resolved === undefined ? {} : { resolved }),
  });
}

function parseCliArgs<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: error.message,
      });
    }
    throw error;
  }
}

async function runSearch(args: string[]): Promise<void> {
  const parsed = parseCliArgs(() => parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      limit: { type: "string" },
      format: { type: "string" },
      policy: { type: "string" },
    },
  }));
  const output = (await createKernel(parsed.values.policy)).search({
    query: parsed.positionals.join(" "),
    limit: asInteger(parsed.values.limit, 8),
  });
  const format = parseFormat(parsed.values.format, ["text", "json"], "text");
  if (format === "json") writeJson(output);
  else writeText((await import("./presentation.js")).presentSearch(output));
  if (output.status === "error") process.exitCode = 2;
}

async function runResolve(args: string[]): Promise<void> {
  const parsed = parseCliArgs(() => parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      context: { type: "string" },
      alternatives: { type: "string" },
      format: { type: "string" },
      policy: { type: "string" },
    },
  }));
  const kernel = await createKernel(parsed.values.policy);
  const output = kernel.resolve({
    intent: parsed.positionals.join(" "),
    alternatives: asInteger(parsed.values.alternatives, 3),
    ...(parsed.values.context === undefined ? {} : { context: parsed.values.context }),
  });
  const format = parseFormat(parsed.values.format, ["json", "text", "svg"], "json");
  if (format === "svg" && output.status === "ok") writeText(output.icon.asset.svg);
  else if (format === "svg") writeFailure(output);
  else if (format === "text" && output.status === "ok") {
    writeText((await import("./presentation.js")).presentResolve(output));
  } else if (format === "text") writeFailure(output);
  else writeJson(output);
  if (output.status !== "ok") process.exitCode = 2;
}

async function runGet(args: string[]): Promise<void> {
  const parsed = parseCliArgs(() => parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      context: { type: "string" },
      format: { type: "string" },
      policy: { type: "string" },
    },
  }));
  const [id, ...extra] = parsed.positionals;
  if (id === undefined || extra.length > 0) {
    throw new IconKernelError({ code: "INVALID_INPUT", message: "get requires exactly one icon id." });
  }
  const output = (await createKernel(parsed.values.policy)).getIcon({
    id,
    ...(parsed.values.context === undefined ? {} : { context: parsed.values.context }),
  });
  const format = parseFormat(parsed.values.format, ["json", "svg"], "json");
  if (format === "svg" && output.status === "ok") writeText(output.icon.asset.svg);
  else if (format === "svg") writeFailure(output);
  else writeJson(output);
  if (output.status !== "ok") process.exitCode = 2;
}

async function runBatch(args: string[]): Promise<void> {
  const parsed = parseCliArgs(() => parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      context: { type: "string" },
      format: { type: "string" },
      "symbol-prefix": { type: "string" },
      output: { type: "string" },
      "inline-into": { type: "string" },
      "resolve-intents": { type: "boolean" },
      "allow-symbol-removal": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      policy: { type: "string" },
    },
  }));
  if (parsed.values.help === true) {
    writeText(HELP);
    return;
  }
  const hasSpriteCarrier = parsed.values.output !== undefined || parsed.values["inline-into"] !== undefined;
  const format = parseFormat(parsed.values.format, ["json", "text", "sprite"], hasSpriteCarrier ? "sprite" : "json");
  const resolveIntents = parsed.values["resolve-intents"] === true;
  const symbolPrefix = parsed.values["symbol-prefix"] ?? "armorial-";
  if (!SYMBOL_PREFIX_PATTERN.test(symbolPrefix)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "symbol-prefix must start with an ASCII letter and contain at most 64 ASCII letters, digits, dots, underscores, colons, or hyphens.",
      field: "symbol-prefix",
    });
  }
  if (parsed.values["symbol-prefix"] !== undefined && format !== "sprite") {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "symbol-prefix is only valid with --format sprite.",
      field: "symbol-prefix",
    });
  }
  if (parsed.values.output !== undefined && format !== "sprite") {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output is only valid with --format sprite.",
      field: "output",
    });
  }
  if (parsed.values["inline-into"] !== undefined && format !== "sprite") {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline-into is only valid with --format sprite.",
      field: "inline-into",
    });
  }
  if (parsed.values.output !== undefined && parsed.values["inline-into"] !== undefined) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "Use either --output or --inline-into, not both.",
      field: "inline-into",
    });
  }
  if (parsed.values["allow-symbol-removal"] === true && parsed.values["inline-into"] === undefined) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "allow-symbol-removal is only valid with --inline-into.",
      field: "allow-symbol-removal",
    });
  }
  if (resolveIntents && (!hasSpriteCarrier || format !== "sprite")) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "resolve-intents requires exactly one --output or --inline-into sprite carrier.",
      field: "resolve-intents",
    });
  }
  const maxBatchSize = resolveIntents
    ? (await import("../core/contracts.js")).MAX_BATCH_SIZE
    : undefined;
  if (maxBatchSize !== undefined && (parsed.positionals.length < 1 || parsed.positionals.length > maxBatchSize)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `resolve-intents requires 1-${maxBatchSize} compact intents.`,
      field: "intents",
    });
  }

  const kernel = await createKernel(parsed.values.policy);
  let resolved: ResolvedIntent[] | undefined;
  let iconIds = parsed.positionals;
  if (resolveIntents) {
    resolved = [];
    const unresolved: UnresolvedIntent[] = [];
    for (const [index, intent] of parsed.positionals.entries()) {
      const resolution = kernel.resolve({
        intent,
        alternatives: 0,
        ...(parsed.values.context === undefined ? {} : { context: parsed.values.context }),
      });
      if (resolution.status !== "ok") {
        unresolved.push({
          index,
          intent,
          code: resolution.error.code,
          message: resolution.error.message,
          ...(resolution.status === "ambiguous"
            ? { candidates: resolution.candidates.map(({ id }) => id) }
            : {}),
        });
        continue;
      }
      resolved.push({ intent, id: resolution.icon.id });
    }
    if (unresolved.length > 0) {
      const codes = new Set(unresolved.map(({ code }) => code));
      writeFailure({
        status: "error",
        kind: "icon_intent_batch",
        error: {
          code: codes.size === 1 ? unresolved[0]!.code : "INVALID_INPUT",
          message: `${unresolved.length} of ${parsed.positionals.length} intents did not resolve; no output was written.`,
          field: "intents",
        },
        resolved,
        unresolved,
      });
      return;
    }
    iconIds = [...new Set(resolved.map(({ id }) => id))];
  } else if (format === "sprite") {
    const normalizedIds = parsed.positionals.map((id) => id.replace(/^icon-park:/, ""));
    if (new Set(normalizedIds).size !== normalizedIds.length) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "A sprite requires unique icon ids.",
        field: "ids",
      });
    }
  }
  const output = kernel.getIcons({
    ids: iconIds,
    ...(parsed.values.context === undefined ? {} : { context: parsed.values.context }),
  });
  if (format === "sprite" && output.status === "ok" && output.summary.failed === 0) {
    const { presentSprite } = await import("./presentation.js");
    const sprite = presentSprite(output, symbolPrefix);
    if (parsed.values.output !== undefined) {
      await writeSpriteFile(parsed.values.output, sprite, output.summary.rendered, resolved);
    } else if (parsed.values["inline-into"] !== undefined) {
      await inlineSpriteIntoHtml(
        parsed.values["inline-into"],
        sprite,
        output.summary.rendered,
        resolved,
        parsed.values["allow-symbol-removal"] === true,
      );
    }
    else writeText(sprite);
  } else if (format === "sprite") writeFailure(output);
  else if (format === "text") writeText((await import("./presentation.js")).presentBatch(output));
  else writeJson(output);
  if (output.status === "error" || (format === "sprite" && output.summary.failed > 0)) process.exitCode = 2;
}

async function runPolicy(args: string[]): Promise<void> {
  const [operation, path, ...extra] = args;
  if (operation === "schema" && path === undefined) {
    writeJson((await import("../core/policy-schema.js")).createPolicyJsonSchema());
    return;
  }
  if (operation === "validate" && path !== undefined && extra.length === 0) {
    const [{ loadPolicyFile }, { IconKernel }] = await Promise.all([
      import("./policy-file.js"),
      import("../core/kernel.js"),
    ]);
    const policy = await loadPolicyFile(path);
    const kernel = new IconKernel(policy);
    writeJson({
      status: "ok",
      kind: "icon_policy_validation",
      collections: kernel.policy.collections,
      contexts: Object.keys(kernel.policy.contexts),
      selections: Object.keys(kernel.policy.selections).length,
    });
    return;
  }
  throw new IconKernelError({
    code: "INVALID_INPUT",
    message: "Use `policy validate <file>` or `policy schema`.",
  });
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = args;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    writeText(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    writeText(KERNEL_VERSION);
    return;
  }

  switch (command) {
    case "mcp":
      await (await import("./mcp.js")).main(rest);
      return;
    case "search":
      await runSearch(rest);
      return;
    case "resolve":
      await runResolve(rest);
      return;
    case "get":
      await runGet(rest);
      return;
    case "batch":
      await runBatch(rest);
      return;
    case "policy":
      await runPolicy(rest);
      return;
    default:
      throw new IconKernelError({ code: "INVALID_INPUT", message: `Unknown command "${command}".` });
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    const kernelError = toKernelError(error);
    process.stderr.write(`${JSON.stringify({ status: "error", error: kernelError }, null, 2)}\n`);
    process.exitCode = error instanceof IconKernelError ? 2 : 1;
  });
}
