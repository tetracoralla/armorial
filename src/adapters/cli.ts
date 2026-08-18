#!/usr/bin/env node
import { parseArgs } from "node:util";
import { KERNEL_VERSION } from "../core/contracts.js";
import { IconKernelError, toKernelError } from "../core/errors.js";
import { IconKernel } from "../core/kernel.js";
import { createPolicyJsonSchema } from "../core/policy-schema.js";
import { isMainModule } from "./main-module.js";
import { loadPolicyFile, resolvePolicyInput } from "./policy-file.js";
import { presentBatch, presentSearch } from "./presentation.js";

type Format = "json" | "text" | "svg";

const HELP = `icon-svg-select ${KERNEL_VERSION}

Usage:
  icon-svg-select search <query...> [--limit 8] [--format text|json] [--policy file]
  icon-svg-select resolve <intent...> [--context name] [--alternatives 3] [--format json|svg] [--policy file]
  icon-svg-select get <icon-id> [--context name] [--format json|svg] [--policy file]
  icon-svg-select batch <icon-id...> [--context name] [--format json|text] [--policy file]
  icon-svg-select policy validate <file>
  icon-svg-select policy schema

Policy resolution order: --policy file, $ICON_SVG_SELECT_POLICY, ./icon-policy.json, built-in default.

The CLI writes results to stdout and never writes SVG files itself.`;

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

async function createKernel(policyPath?: string): Promise<IconKernel> {
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
  else writeText(presentSearch(output));
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
  const format = parseFormat(parsed.values.format, ["json", "svg"], "json");
  if (format === "svg" && output.status === "ok") writeText(output.icon.asset.svg);
  else if (format === "svg") writeFailure(output);
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
      policy: { type: "string" },
    },
  }));
  const output = (await createKernel(parsed.values.policy)).getIcons({
    ids: parsed.positionals,
    ...(parsed.values.context === undefined ? {} : { context: parsed.values.context }),
  });
  const format = parseFormat(parsed.values.format, ["json", "text"], "json");
  if (format === "text") writeText(presentBatch(output));
  else writeJson(output);
  if (output.status === "error") process.exitCode = 2;
}

async function runPolicy(args: string[]): Promise<void> {
  const [operation, path, ...extra] = args;
  if (operation === "schema" && path === undefined) {
    writeJson(createPolicyJsonSchema());
    return;
  }
  if (operation === "validate" && path !== undefined && extra.length === 0) {
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
