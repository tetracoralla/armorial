import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const cliIndex = args.indexOf("--cli");
assert.notEqual(cliIndex, -1, "Usage: probe-inline-candidate.mjs --cli /absolute/path/to/cli.js");
const cli = resolve(args[cliIndex + 1] ?? "");
assert.equal(isAbsolute(cli), true);

const sourceConflictInjector = resolve(import.meta.dirname, "inject-inline-conflict.mjs");
const outputRaceInjector = resolve(import.meta.dirname, "inject-inline-candidate-output-race.mjs");
const finalRaceInjector = resolve(import.meta.dirname, "inject-inline-final-race.mjs");
const original = Buffer.from("<!doctype html><html><body><main>ORIGINAL-01</main></body></html>\n", "utf8");
const external = Buffer.from("<!doctype html><html><body><main>EXTERNAL-01</main></body></html>\n", "utf8");
const competingOutput = Buffer.from("COMPETING-CANDIDATE\n", "utf8");
assert.equal(external.byteLength, original.byteLength);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function run(root, helperImport, env, ...cliArgs) {
  return spawnSync(process.execPath, [cli, ...cliArgs], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(helperImport).href}`].filter(Boolean).join(" "),
    },
  });
}

const root = mkdtempSync(join(tmpdir(), "armorial-inline-candidate-"));
try {
  const observations = [];
  for (const method of ["in-place", "replace"]) {
    const sourceName = `source-${method}.html`;
    const outputName = `candidate-${method}.html`;
    const source = join(root, sourceName);
    const output = join(root, outputName);
    writeFileSync(source, original);
    const before = statSync(source, { bigint: true });
    const result = run(
      root,
      sourceConflictInjector,
      {
        ARMORIAL_INLINE_CONFLICT_TARGET: source,
        ARMORIAL_INLINE_CONFLICT_CONTENT_BASE64: external.toString("base64"),
        ARMORIAL_INLINE_CONFLICT_METHOD: method,
      },
      "batch",
      "icon-park:search",
      "--inline-from",
      sourceName,
      "--output",
      outputName,
      "--format",
      "json",
    );
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.protectionLevel, "non_overwriting_candidate");
    assert.equal(summary.sourceSha256, sha256(original));
    assert.equal(summary.candidateSha256, sha256(readFileSync(output)));
    assert.deepEqual(readFileSync(source), external);
    const after = statSync(source, { bigint: true });
    if (method === "in-place") assert.equal(after.ino, before.ino);
    else assert.notEqual(after.ino, before.ino);
    observations.push({ method, protectionLevel: summary.protectionLevel, sourcePreserved: true });
  }

  const source = join(root, "race-source.html");
  const output = join(root, "raced-output.html");
  writeFileSync(source, original);
  const outputRace = run(
    root,
    outputRaceInjector,
    {
      ARMORIAL_INLINE_CANDIDATE_TARGET: output,
      ARMORIAL_INLINE_CANDIDATE_CONTENT_BASE64: competingOutput.toString("base64"),
    },
    "batch",
    "icon-park:user",
    "--inline-from",
    "race-source.html",
    "--output",
    "raced-output.html",
    "--format",
    "json",
  );
  assert.equal(outputRace.status, 2, outputRace.stderr);
  assert.equal(outputRace.stdout, "");
  assert.equal(JSON.parse(outputRace.stderr).error.code, "INVALID_INPUT");
  assert.deepEqual(readFileSync(source), original);
  assert.deepEqual(readFileSync(output), competingOutput);

  const hardLinkRaceOutput = join(root, "raced-hard-link.html");
  const hardLinkRace = run(
    root,
    outputRaceInjector,
    {
      ARMORIAL_INLINE_CANDIDATE_TARGET: hardLinkRaceOutput,
      ARMORIAL_INLINE_CANDIDATE_SOURCE_TARGET: source,
    },
    "batch",
    "icon-park:user",
    "--inline-from",
    "race-source.html",
    "--output",
    "raced-hard-link.html",
    "--format",
    "json",
  );
  assert.equal(hardLinkRace.status, 2, hardLinkRace.stderr);
  assert.equal(hardLinkRace.stdout, "");
  assert.match(JSON.parse(hardLinkRace.stderr).error.message, /hard-link alias/);
  assert.deepEqual(readFileSync(source), original);
  assert.deepEqual(readFileSync(hardLinkRaceOutput), original);

  const samePath = spawnSync(process.execPath, [
    cli,
    "batch",
    "icon-park:user",
    "--inline-from",
    "race-source.html",
    "--output",
    "race-source.html",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(samePath.status, 2);
  const alias = join(root, "source-alias.html");
  linkSync(source, alias);
  const aliasResult = spawnSync(process.execPath, [
    cli,
    "batch",
    "icon-park:user",
    "--inline-from",
    "race-source.html",
    "--output",
    "source-alias.html",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(aliasResult.status, 2);
  assert.deepEqual(readFileSync(source), original);
  assert.deepEqual(readFileSync(alias), original);

  const optimistic = [];
  for (const method of ["in-place", "replace"]) {
    const targetName = `optimistic-${method}.html`;
    const target = join(root, targetName);
    writeFileSync(target, original);
    const result = run(
      root,
      finalRaceInjector,
      {
        ARMORIAL_INLINE_FINAL_RACE_TARGET: target,
        ARMORIAL_INLINE_FINAL_RACE_CONTENT_BASE64: external.toString("base64"),
        ARMORIAL_INLINE_FINAL_RACE_METHOD: method,
      },
      "batch",
      "icon-park:search",
      "--inline-into",
      targetName,
      "--allow-optimistic-overwrite",
      "--format",
      "json",
    );
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.protectionLevel, "optimistic_preflight_only");
    assert.match(summary.concurrencyWarning, /after Armorial's final check and before atomic rename/);
    assert.notDeepEqual(readFileSync(target), external, "the probe must reproduce the disclosed overwrite window");
    optimistic.push({ method, protectionLevel: summary.protectionLevel, finalWindowReproduced: true });
  }

  assert.deepEqual(
    readdirSync(root).filter((name) => name.includes(".armorial-") && name.endsWith(".tmp")),
    [],
  );
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    cli,
    candidate: observations,
    outputRace: "INVALID_INPUT+competing-output-preserved",
    hardLinkRace: "INVALID_INPUT+source-alias-preserved",
    aliases: "same-path+hard-link-rejected",
    optimistic,
    residue: 0,
  })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
