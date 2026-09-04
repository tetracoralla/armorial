#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  RenderStyleOverrideSchema,
  type RenderStyleOverride,
} from "../core/contracts.js";
import { KERNEL_VERSION } from "../version.js";
import { IconKernelError, toKernelError, zodIssuesToKernelError } from "../core/errors.js";
import {
  inlineSpriteIntoHtml,
  type ResolvedIntent,
  writeInlineSpriteCandidate,
  writeSpriteFile,
} from "./cli-artifact.js";
import { isMainModule } from "./main-module.js";

type Format = "json" | "text" | "svg" | "sprite";

const SYMBOL_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
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
  armorial resolve <intent...> [--context name] [render options] [--alternatives 3] [--format json|text|svg] [--policy file]
  armorial get <icon-id> [--context name] [render options] [--format json|svg] [--policy file]
  armorial batch <icon-id...> [--context name] [render options] [--format json|text|sprite] [--symbol-prefix text] [--output relative.svg] [--allow-optimistic-overwrite] [--policy file]
  armorial batch <icon-id...> [--context name] [render options] [--format json|sprite] [--symbol-prefix text] --inline-from source.html --output candidate.html [--allow-symbol-removal] [--policy file]
  armorial batch <icon-id...> [--context name] [render options] [--format json|sprite] [--symbol-prefix text] --inline-into relative.html --allow-optimistic-overwrite [--allow-symbol-removal] [--policy file]
  armorial batch <intent...> --resolve-intents [--context name] [render options] [--format json|text] [--policy file]
  armorial batch <intent...> --resolve-intents [--context name] [render options] [--format json|sprite] [--symbol-prefix text] (--output relative.svg [--allow-optimistic-overwrite] | --inline-from source.html --output candidate.html | --inline-into relative.html --allow-optimistic-overwrite) [--allow-symbol-removal] [--policy file]
  armorial policy validate <file>
  armorial policy schema

Render options: --theme, --size, --stroke-width, --stroke-linecap, --stroke-linejoin,
                --primary, --secondary, --inner-stroke, --inner-fill.

Policy resolution order: --policy file, $ICON_SVG_SELECT_POLICY, ./icon-policy.json, built-in default.

With a carrier, omit --format or use --format json|sprite: the carrier receives a sprite and stdout receives a compact JSON summary.
New SVG and --inline-from outputs are create-only and reject --allow-optimistic-overwrite. Replacing an existing SVG or using --inline-into requires that flag because the final check-to-rename window cannot exclude a non-cooperating writer.`;

const RENDER_OPTIONS = {
  theme: { type: "string" },
  size: { type: "string" },
  "stroke-width": { type: "string" },
  "stroke-linecap": { type: "string" },
  "stroke-linejoin": { type: "string" },
  primary: { type: "string" },
  secondary: { type: "string" },
  "inner-stroke": { type: "string" },
  "inner-fill": { type: "string" },
} as const;

type CliRenderValues = Readonly<{
  theme?: string;
  size?: string;
  "stroke-width"?: string;
  "stroke-linecap"?: string;
  "stroke-linejoin"?: string;
  primary?: string;
  secondary?: string;
  "inner-stroke"?: string;
  "inner-fill"?: string;
}>;

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

function parseRenderOverride(values: CliRenderValues): RenderStyleOverride | undefined {
  const colors = {
    ...(values.primary === undefined ? {} : { primary: values.primary }),
    ...(values.secondary === undefined ? {} : { secondary: values.secondary }),
    ...(values["inner-stroke"] === undefined ? {} : { innerStroke: values["inner-stroke"] }),
    ...(values["inner-fill"] === undefined ? {} : { innerFill: values["inner-fill"] }),
  };
  const input = {
    ...(values.theme === undefined ? {} : { theme: values.theme }),
    ...(values.size === undefined ? {} : { size: asInteger(values.size, Number.NaN) }),
    ...(values["stroke-width"] === undefined
      ? {}
      : { strokeWidth: asInteger(values["stroke-width"], Number.NaN) }),
    ...(values["stroke-linecap"] === undefined ? {} : { strokeLinecap: values["stroke-linecap"] }),
    ...(values["stroke-linejoin"] === undefined ? {} : { strokeLinejoin: values["stroke-linejoin"] }),
    ...(Object.keys(colors).length === 0 ? {} : { colors }),
  };
  if (Object.keys(input).length === 0) return undefined;
  const parsed = RenderStyleOverrideSchema.safeParse(input);
  if (!parsed.success) {
    throw new IconKernelError(zodIssuesToKernelError(
      "INVALID_INPUT",
      parsed.error,
      "The render override is invalid.",
    ));
  }
  return parsed.data;
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
      ...RENDER_OPTIONS,
    },
  }));
  const render = parseRenderOverride(parsed.values);
  const kernel = await createKernel(parsed.values.policy);
  const output = kernel.resolve({
    intent: parsed.positionals.join(" "),
    alternatives: asInteger(parsed.values.alternatives, 3),
    ...(parsed.values.context === undefined ? {} : { context: parsed.values.context }),
    ...(render === undefined ? {} : { render }),
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
      ...RENDER_OPTIONS,
    },
  }));
  const [id, ...extra] = parsed.positionals;
  if (id === undefined || extra.length > 0) {
    throw new IconKernelError({ code: "INVALID_INPUT", message: "get requires exactly one icon id." });
  }
  const render = parseRenderOverride(parsed.values);
  const output = (await createKernel(parsed.values.policy)).getIcon({
    id,
    ...(parsed.values.context === undefined ? {} : { context: parsed.values.context }),
    ...(render === undefined ? {} : { render }),
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
      "inline-from": { type: "string" },
      "inline-into": { type: "string" },
      "resolve-intents": { type: "boolean" },
      "allow-symbol-removal": { type: "boolean" },
      "allow-optimistic-overwrite": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      policy: { type: "string" },
      ...RENDER_OPTIONS,
    },
  }));
  if (parsed.values.help === true) {
    writeText(HELP);
    return;
  }
  const hasInlineCandidate = parsed.values["inline-from"] !== undefined;
  const hasSpriteCarrier = parsed.values.output !== undefined || parsed.values["inline-into"] !== undefined;
  const requestedFormat = parsed.values.format;
  const format = hasSpriteCarrier && (requestedFormat === undefined || requestedFormat === "json")
    ? "sprite"
    : parseFormat(requestedFormat, ["json", "text", "sprite"], "json");
  const resolveIntents = parsed.values["resolve-intents"] === true;
  const render = parseRenderOverride(parsed.values);
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
  if (hasInlineCandidate && parsed.values.output === undefined) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline-from requires one new --output .html candidate path.",
      field: "inline-from",
    });
  }
  if (parsed.values.output !== undefined && !hasInlineCandidate && !/\.svg$/i.test(parsed.values.output)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output must end in .svg unless --inline-from selects a new HTML candidate.",
      field: "output",
    });
  }
  if (hasInlineCandidate && parsed.values["inline-into"] !== undefined) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "Use either --inline-from with --output or --inline-into, not both.",
      field: "inline-from",
    });
  }
  if (parsed.values["allow-symbol-removal"] === true && !hasInlineCandidate && parsed.values["inline-into"] === undefined) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "allow-symbol-removal is only valid with an inline HTML carrier.",
      field: "allow-symbol-removal",
    });
  }
  if (parsed.values["inline-into"] !== undefined && parsed.values["allow-optimistic-overwrite"] !== true) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline-into can overwrite a non-cooperating editor save in the final check-to-rename window. Use --inline-from with a new --output candidate, or explicitly pass --allow-optimistic-overwrite.",
      field: "inline-into",
    });
  }
  if (
    parsed.values["allow-optimistic-overwrite"] === true
    && parsed.values["inline-into"] === undefined
    && (parsed.values.output === undefined || hasInlineCandidate)
  ) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "allow-optimistic-overwrite is valid only for an existing SVG --output or --inline-into; HTML candidates remain create-only.",
      field: "allow-optimistic-overwrite",
    });
  }
  if (format === "sprite" && render?.size !== undefined) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "size belongs to each consuming <svg> element and cannot be encoded in an SVG <symbol> carrier.",
      field: "size",
    });
  }
  if (resolveIntents && format === "sprite" && !hasSpriteCarrier) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "resolve-intents with sprite format requires one output carrier.",
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
        ...(render === undefined ? {} : { render }),
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
    if (!hasSpriteCarrier) {
      const items = resolved.map(({ intent, id }, index) => ({ index, intent, id }));
      if (format === "text") {
        writeText(items.map(({ index, intent, id }) => `${index}\t${JSON.stringify(intent)}\t${id}`).join("\n"));
      } else {
        writeJson({
          status: "ok",
          kind: "icon_intent_batch",
          summary: {
            requested: items.length,
            resolved: items.length,
            uniqueIcons: new Set(items.map(({ id }) => id)).size,
          },
          items,
        });
      }
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
    ...(render === undefined ? {} : { render }),
  });
  if (format === "sprite" && output.status === "ok" && output.summary.failed === 0) {
    const { presentSprite } = await import("./presentation.js");
    const sprite = presentSprite(output, symbolPrefix);
    if (hasInlineCandidate && parsed.values.output !== undefined) {
      await writeInlineSpriteCandidate(
        parsed.values["inline-from"]!,
        parsed.values.output,
        sprite,
        output.summary.rendered,
        resolved,
        parsed.values["allow-symbol-removal"] === true,
      );
    } else if (parsed.values.output !== undefined) {
      await writeSpriteFile(
        parsed.values.output,
        sprite,
        output.summary.rendered,
        resolved,
        parsed.values["allow-optimistic-overwrite"] === true,
      );
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
    process.exitCode = error instanceof IconKernelError
      && !["PUBLICATION_OUTCOME_UNCERTAIN", "INTERNAL_ERROR"].includes(error.error.code)
      ? 2
      : 1;
  });
}
