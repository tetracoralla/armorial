import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

const args = process.argv.slice(2);
const cliIndex = args.indexOf("--cli");
assert.notEqual(cliIndex, -1, "Usage: probe-inline-conflict.mjs --cli /absolute/path/to/cli.js");
const cli = resolve(args[cliIndex + 1] ?? "");
assert.equal(isAbsolute(cli), true);

const injector = resolve(import.meta.dirname, "inject-inline-conflict.mjs");
const original = Buffer.from("<!doctype html><html><body><main>ORIGINAL-01</main></body></html>\n", "utf8");
const external = Buffer.from("<!doctype html><html><body><main>EXTERNAL-01</main></body></html>\n", "utf8");
assert.equal(external.byteLength, original.byteLength);

const observations = [];
for (const method of ["in-place", "replace"]) {
  const root = mkdtempSync(join(tmpdir(), `armorial-inline-conflict-${method}-`));
  try {
    const target = join(root, "index.html");
    writeFileSync(target, original);
    const before = statSync(target, { bigint: true });
    const result = spawnSync(process.execPath, [
      "--import",
      injector,
      cli,
      "batch",
      "icon-park:search",
      "--inline-into",
      basename(target),
      "--format",
      "json",
    ], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ARMORIAL_INLINE_CONFLICT_TARGET: target,
        ARMORIAL_INLINE_CONFLICT_CONTENT_BASE64: external.toString("base64"),
        ARMORIAL_INLINE_CONFLICT_METHOD: method,
      },
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      status: "error",
      error: {
        code: "INVALID_INPUT",
        message: "inline-into HTML changed after Armorial read it; the external version was preserved. Retry with a stable task file.",
        field: "inline-into",
      },
    });
    assert.deepEqual(readFileSync(target), external);
    const after = statSync(target, { bigint: true });
    if (method === "in-place") assert.equal(after.ino, before.ino);
    else assert.notEqual(after.ino, before.ino);
    const residue = readdirSync(root).filter((name) => name.includes(".armorial-") && name.endsWith(".tmp"));
    assert.deepEqual(residue, []);
    observations.push({ method, exit: result.status, code: "INVALID_INPUT", externalBytes: Number(after.size), residue: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

process.stdout.write(`${JSON.stringify({ status: "ok", observations })}\n`);
