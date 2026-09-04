import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";

const args = process.argv.slice(2);
const cliIndex = args.indexOf("--cli");
assert.notEqual(cliIndex, -1, "Usage: probe-publication-basename.mjs --cli /absolute/path/to/cli.js");
const cli = resolve(args[cliIndex + 1] ?? "");
assert.equal(isAbsolute(cli), true);
const sourceMode = extname(cli) === ".ts";
const tsxImport = import.meta.resolve("tsx");
const sourceHtml = Buffer.from("<!doctype html><html><body><main>KEEP</main></body></html>\n", "utf8");
const originalSvg = Buffer.from("ORIGINAL\n", "utf8");

function exactName(bytes, extension, multibyte = false) {
  const available = bytes - Buffer.byteLength(extension);
  assert.ok(available >= 0);
  const wide = multibyte ? "界".repeat(Math.floor(available / 3)) : "";
  const ascii = "a".repeat(available - Buffer.byteLength(wide));
  const result = `${wide}${ascii}${extension}`;
  assert.equal(Buffer.byteLength(result), bytes);
  return result;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function residue(directory) {
  return readdirSync(directory).filter((name) => name.startsWith(".armorial-publish-") && name.endsWith(".tmp"));
}

function runCli(root, commandArgs) {
  return spawnSync(process.execPath, [
    ...(sourceMode ? ["--import", tsxImport] : []),
    cli,
    ...commandArgs,
  ], { cwd: root, encoding: "utf8" });
}

function exerciseValid(operation, bytes, multibyte = false) {
  const root = mkdtempSync(join(tmpdir(), `armorial-basename-${operation}-${bytes}-`));
  try {
    const extension = operation.startsWith("svg") ? ".svg" : ".html";
    const name = exactName(bytes, extension, multibyte);
    const target = join(root, name);
    let commandArgs;
    if (operation === "svg-create") {
      commandArgs = ["batch", "icon-park:search", "--output", name, "--format", "json"];
    } else if (operation === "svg-replace") {
      writeFileSync(target, originalSvg);
      chmodSync(target, 0o640);
      commandArgs = ["batch", "icon-park:search", "--output", name, "--allow-optimistic-overwrite", "--format", "json"];
    } else if (operation === "candidate") {
      writeFileSync(join(root, "source.html"), sourceHtml);
      commandArgs = ["batch", "icon-park:search", "--inline-from", "source.html", "--output", name, "--format", "json"];
    } else {
      writeFileSync(target, sourceHtml);
      chmodSync(target, 0o640);
      commandArgs = ["batch", "icon-park:search", "--inline-into", name, "--allow-optimistic-overwrite", "--format", "json"];
    }
    const result = runCli(root, commandArgs);
    assert.equal(result.status, 0, `${operation}/${bytes}/${multibyte}\n${result.stderr}`);
    const summary = JSON.parse(result.stdout);
    const actual = readFileSync(target);
    assert.equal(operation === "candidate" || operation === "legacy" ? summary.candidateSha256 : summary.sha256, sha256(actual));
    if (operation === "svg-create") assert.equal(summary.protectionLevel, "non_overwriting_create");
    if (operation === "candidate") {
      assert.equal(summary.protectionLevel, "non_overwriting_candidate");
      assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    }
    if (operation === "svg-replace" || operation === "legacy") {
      assert.equal(summary.protectionLevel, "optimistic_preflight_only");
      assert.match(String(summary.concurrencyWarning), /final check and before atomic rename/);
      assert.equal(statSync(target).mode & 0o777, 0o640);
    }
    assert.deepEqual(residue(root), []);
    return { operation, bytes, multibyte, status: "published" };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function exerciseInvalid(operation, multibyte = false) {
  const root = mkdtempSync(join(tmpdir(), `armorial-basename-invalid-${operation}-`));
  try {
    writeFileSync(join(root, "source.html"), sourceHtml);
    const extension = operation.startsWith("svg") ? ".svg" : ".html";
    const name = exactName(256, extension, multibyte);
    const commandArgs = operation === "svg-create"
      ? ["batch", "icon-park:search", "--output", name, "--format", "json"]
      : operation === "svg-replace"
        ? ["batch", "icon-park:search", "--output", name, "--allow-optimistic-overwrite", "--format", "json"]
        : operation === "candidate"
          ? ["batch", "icon-park:search", "--inline-from", "source.html", "--output", name, "--format", "json"]
          : ["batch", "icon-park:search", "--inline-into", name, "--allow-optimistic-overwrite", "--format", "json"];
    const result = runCli(root, commandArgs);
    assert.equal(result.status, 2, `${operation}/256/${multibyte}\n${result.stderr}`);
    assert.equal(result.stdout, "");
    const failure = JSON.parse(result.stderr).error;
    assert.equal(failure?.code, "INVALID_INPUT");
    assert.match(String(failure?.message), /255 UTF-8 bytes/);
    assert.equal(existsSync(join(root, name)), false);
    assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    assert.deepEqual(residue(root), []);
    return { operation, bytes: 256, multibyte, status: "INVALID_INPUT" };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const observations = [];
for (const operation of ["svg-create", "svg-replace", "candidate", "legacy"]) {
  for (const bytes of [196, 197, 255]) observations.push(exerciseValid(operation, bytes));
  observations.push(exerciseValid(operation, 255, true));
  observations.push(exerciseInvalid(operation));
  observations.push(exerciseInvalid(operation, true));
}

process.stdout.write(`${JSON.stringify({
  status: "ok",
  cli,
  temporaryName: "destination-independent+exclusive+pinned-parent",
  observations,
})}\n`);
