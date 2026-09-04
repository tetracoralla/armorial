import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const cliIndex = args.indexOf("--cli");
assert.notEqual(cliIndex, -1, "Usage: probe-pinned-publication.mjs --cli /absolute/path/to/cli.js");
const cli = resolve(args[cliIndex + 1] ?? "");
assert.equal(isAbsolute(cli), true);

const injector = resolve(import.meta.dirname, "inject-publish-parent-swap.mjs");
const finalRaceInjector = resolve(import.meta.dirname, "inject-inline-final-race.mjs");
const restrictiveUmaskInjector = resolve(import.meta.dirname, "inject-restrictive-umask.mjs");
const helperFailureInjector = resolve(import.meta.dirname, "inject-publish-helper-failure.mjs");
const tsxImport = import.meta.resolve("tsx");
const sourceMode = extname(cli) === ".ts";
const sourceHtml = Buffer.from("<!doctype html><html><body><main>PINNED-SOURCE</main></body></html>\n", "utf8");
const competingHtml = Buffer.from("<!doctype html><html><body><main>OUTSIDE-COMPETE</main></body></html>\n", "utf8");
const originalSprite = Buffer.from("ORIGINAL-SPRITE\n", "utf8");
const competingSprite = Buffer.from("OUTSIDE-SPRITE\n", "utf8");

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function residue(directory) {
  return readdirSync(directory).filter((name) => name.includes(".armorial-publish-") && name.endsWith(".tmp"));
}

function testNodeOptions(modulePath, existing = process.env.NODE_OPTIONS) {
  const option = `--import=${pathToFileURL(modulePath).href}`;
  return existing === undefined || existing === "" ? option : `${existing} ${option}`;
}

function runCli(root, mode, environment, commandArgs, parentImports = []) {
  const nodeArgs = [
    ...(mode === "before-spawn" ? ["--import", injector] : []),
    ...parentImports.flatMap((modulePath) => ["--import", modulePath]),
    ...(sourceMode ? ["--import", tsxImport] : []),
    cli,
    ...commandArgs,
  ];
  return spawnSync(process.execPath, nodeArgs, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      ...(mode === "after-cwd-pin" ? {
        NODE_OPTIONS: testNodeOptions(injector, environment.NODE_OPTIONS ?? process.env.NODE_OPTIONS),
      } : {}),
    },
  });
}

function exerciseSwap(operation, mode) {
  const root = mkdtempSync(join(tmpdir(), `armorial-parent-swap-${operation}-${mode}-`));
  const outside = mkdtempSync(join(tmpdir(), `armorial-parent-outside-${operation}-${mode}-`));
  try {
    const targetParent = join(root, "output");
    const backupParent = join(root, "output.pinned");
    mkdirSync(targetParent);
    const destinationName = operation === "svg" ? "icons.svg" : operation === "inline" ? "page.html" : "page.armorial.html";
    const originalTarget = operation === "svg" ? originalSprite : sourceHtml;
    const outsideTarget = operation === "svg" ? competingSprite : competingHtml;
    if (operation !== "candidate") writeFileSync(join(targetParent, destinationName), originalTarget);
    writeFileSync(join(outside, destinationName), outsideTarget);
    if (operation === "candidate") writeFileSync(join(root, "source.html"), sourceHtml);

    const environment = {
      ARMORIAL_PUBLISH_PARENT_SWAP_MODE: mode,
      ARMORIAL_PUBLISH_PARENT_SWAP_TARGET: targetParent,
      ARMORIAL_PUBLISH_PARENT_SWAP_BACKUP: backupParent,
      ARMORIAL_PUBLISH_PARENT_SWAP_OUTSIDE: outside,
    };
    const commandArgs = operation === "svg"
      ? ["batch", "icon-park:search", "--output", `output/${destinationName}`, "--allow-optimistic-overwrite", "--format", "json"]
      : operation === "candidate"
        ? ["batch", "icon-park:search", "--inline-from", "source.html", "--output", `output/${destinationName}`, "--format", "json"]
        : ["batch", "icon-park:search", "--inline-into", `output/${destinationName}`, "--allow-optimistic-overwrite", "--format", "json"];
    const result = runCli(root, mode, environment, commandArgs);
    assert.deepEqual(readFileSync(join(outside, destinationName)), outsideTarget, `${operation}/${mode} must not write through the replacement parent`);
    assert.deepEqual(residue(outside), []);
    assert.deepEqual(residue(backupParent), []);
    if (mode === "before-spawn") {
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout, "");
      const failure = JSON.parse(result.stderr);
      assert.equal(failure.error?.code, "INVALID_INPUT");
      assert.match(String(failure.error?.message), /parent directory changed/);
      if (operation === "candidate") assert.equal(existsSync(join(backupParent, destinationName)), false);
      else assert.deepEqual(readFileSync(join(backupParent, destinationName)), originalTarget);
      return { operation, mode, status: "closed-before-write" };
    }
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const actual = readFileSync(join(backupParent, destinationName));
    const reportedHash = operation === "candidate" || operation === "inline"
      ? summary.candidateSha256
      : summary.sha256;
    assert.equal(reportedHash, sha256(actual));
    if (operation === "candidate") {
      assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
      assert.equal(summary.protectionLevel, "non_overwriting_candidate");
    }
    if (operation === "inline" || operation === "svg") {
      assert.equal(summary.protectionLevel, "optimistic_preflight_only");
      assert.match(String(summary.concurrencyWarning), /final check and before atomic rename/);
    }
    return { operation, mode, status: "published-to-pinned-inode", sha256: reportedHash };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

function exerciseSvgOverwriteBoundary() {
  const root = mkdtempSync(join(tmpdir(), "armorial-svg-overwrite-boundary-"));
  try {
    const unnecessaryTarget = join(root, "new-with-unnecessary-flag.svg");
    const unnecessary = runCli(root, "none", {}, [
      "batch", "icon-park:search", "--output", "new-with-unnecessary-flag.svg", "--allow-optimistic-overwrite", "--format", "json",
    ]);
    assert.equal(unnecessary.status, 2, unnecessary.stderr);
    assert.equal(unnecessary.stdout, "");
    const unnecessaryFailure = JSON.parse(unnecessary.stderr);
    assert.equal(unnecessaryFailure.error?.code, "INVALID_INPUT");
    assert.equal(unnecessaryFailure.error?.field, "allow-optimistic-overwrite");
    assert.match(String(unnecessaryFailure.error?.message), /only when output already exists/);
    assert.equal(existsSync(unnecessaryTarget), false);
    assert.deepEqual(residue(root), []);

    const target = join(root, "icons.svg");
    writeFileSync(target, originalSprite);
    chmodSync(target, 0o640);
    const denied = runCli(root, "none", {}, [
      "batch", "icon-park:search", "--output", "icons.svg", "--format", "json",
    ]);
    assert.equal(denied.status, 2, denied.stderr);
    assert.equal(denied.stdout, "");
    assert.match(String(JSON.parse(denied.stderr).error?.message), /allow-optimistic-overwrite/);
    assert.deepEqual(readFileSync(target), originalSprite);

    const external = Buffer.from("EXTERNAL-WRITER\n", "utf8");
    const allowed = runCli(root, "none", {
      NODE_OPTIONS: testNodeOptions(finalRaceInjector),
      ARMORIAL_INLINE_FINAL_RACE_TARGET: target,
      ARMORIAL_INLINE_FINAL_RACE_CONTENT_BASE64: external.toString("base64"),
      ARMORIAL_INLINE_FINAL_RACE_METHOD: "replace",
    }, [
      "batch", "icon-park:search", "--output", "icons.svg", "--allow-optimistic-overwrite", "--format", "json",
    ]);
    assert.equal(allowed.status, 0, allowed.stderr);
    const summary = JSON.parse(allowed.stdout);
    assert.equal(summary.protectionLevel, "optimistic_preflight_only");
    assert.match(String(summary.concurrencyWarning), /final check and before atomic rename/);
    assert.equal(summary.sha256, sha256(readFileSync(target)));
    assert.equal(readFileSync(target).equals(external), false, "the explicitly accepted final race must be reproduced");
    assert.equal(statSync(target).mode & 0o777, 0o640, "explicit replacement must preserve the admitted target mode");
    assert.deepEqual(residue(root), []);
    return {
      unnecessary: "absent-output-rejected",
      default: "existing-output-preserved",
      explicit: "optimistic-window-reproduced-and-disclosed",
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function exerciseRestrictiveUmask() {
  const root = mkdtempSync(join(tmpdir(), "armorial-svg-restrictive-umask-"));
  try {
    const target = join(root, "icons.svg");
    const result = runCli(root, "none", {}, [
      "batch", "icon-park:search", "--output", "icons.svg", "--format", "json",
    ], [restrictiveUmaskInjector]);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.protectionLevel, "non_overwriting_create");
    assert.equal(summary.sha256, sha256(readFileSync(target)));
    assert.equal(statSync(target).mode & 0o777, 0o600, "new SVG must respect a restrictive caller umask");
    assert.deepEqual(residue(root), []);
    return "0600-new-svg";
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function exerciseNoProductionTestHooks() {
  const root = mkdtempSync(join(tmpdir(), "armorial-no-production-test-hooks-"));
  try {
    const target = join(root, "icons.svg");
    const result = runCli(root, "none", {
      ARMORIAL_PUBLISH_HELPER_TEST_IMPORT: join(root, "missing-test-import.mjs"),
      ARMORIAL_PUBLISH_HELPER_TEST_FAILURE: "partial-write",
    }, [
      "batch", "icon-park:search", "--output", "icons.svg", "--format", "json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.protectionLevel, "non_overwriting_create");
    assert.equal(summary.sha256, sha256(readFileSync(target)));
    assert.deepEqual(residue(root), []);
    return "legacy-test-environment-ignored";
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function publicationFixture(root, operation) {
  if (operation === "candidate") {
    writeFileSync(join(root, "source.html"), sourceHtml);
    return {
      target: "candidate.html",
      args: ["batch", "icon-park:search", "--inline-from", "source.html", "--output", "candidate.html", "--format", "json"],
      protectionLevel: "non_overwriting_candidate",
      hashField: "candidateSha256",
    };
  }
  if (operation === "legacy-replace") {
    writeFileSync(join(root, "page.html"), sourceHtml);
    chmodSync(join(root, "page.html"), 0o640);
    return {
      target: "page.html",
      original: sourceHtml,
      args: ["batch", "icon-park:search", "--inline-into", "page.html", "--allow-optimistic-overwrite", "--format", "json"],
      protectionLevel: "optimistic_preflight_only",
      hashField: "candidateSha256",
    };
  }
  if (operation === "svg-replace") {
    writeFileSync(join(root, "icons.svg"), originalSprite);
    chmodSync(join(root, "icons.svg"), 0o640);
    return {
      target: "icons.svg",
      original: originalSprite,
      args: ["batch", "icon-park:search", "--output", "icons.svg", "--allow-optimistic-overwrite", "--format", "json"],
      protectionLevel: "optimistic_preflight_only",
      hashField: "sha256",
    };
  }
  return {
    target: "icons.svg",
    args: ["batch", "icon-park:search", "--output", "icons.svg", "--format", "json"],
    protectionLevel: "non_overwriting_create",
    hashField: "sha256",
  };
}

function exerciseHelperFailure(operation, failure) {
  const root = mkdtempSync(join(tmpdir(), `armorial-publish-helper-${operation}-${failure}-`));
  try {
    const fixture = publicationFixture(root, operation);
    const result = runCli(root, "none", {
      NODE_OPTIONS: testNodeOptions(helperFailureInjector),
      ARMORIAL_TEST_PUBLISH_HELPER_FAILURE: failure,
    }, fixture.args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    const error = JSON.parse(result.stderr).error;
    assert.equal(error?.code, "INTERNAL_ERROR");
    if (failure === "open-failure") {
      assert.match(String(error?.message), /publisher open failure/);
      assert.doesNotMatch(String(error?.message), /TEMPORARY_CLEANUP_FAILED/);
    }
    if (failure === "partial-write-cleanup-failure") {
      assert.match(String(error?.message), /partial publisher failure/);
      assert.doesNotMatch(String(error?.message), /TEMPORARY_CLEANUP_FAILED|cleanup failure/);
    }
    if (failure === "close-failure") {
      assert.match(String(error?.message), /publisher close failure/);
      assert.doesNotMatch(String(error?.message), /TEMPORARY_CLEANUP_FAILED/);
    }
    if (operation === "candidate") assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    if (fixture.original === undefined) assert.equal(existsSync(join(root, fixture.target)), false);
    else assert.deepEqual(readFileSync(join(root, fixture.target)), fixture.original);
    assert.deepEqual(residue(root), []);
    return { operation, failure, status: "closed-without-final-effect" };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function exercisePublicationSuccess(operation) {
  const root = mkdtempSync(join(tmpdir(), `armorial-publication-success-${operation}-`));
  try {
    const fixture = publicationFixture(root, operation);
    const result = runCli(root, "none", {}, fixture.args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const summary = JSON.parse(result.stdout);
    const actual = readFileSync(join(root, fixture.target));
    assert.equal(summary[fixture.hashField], sha256(actual));
    assert.equal(summary.protectionLevel, fixture.protectionLevel);
    assert.equal(summary.cleanupWarning, undefined);
    if (operation === "candidate") assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    assert.deepEqual(residue(root), []);
    return { operation, status: "published-with-truthful-summary", sha256: summary[fixture.hashField], protectionLevel: summary.protectionLevel };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function exercisePostCommitCleanupWarning(operation) {
  const root = mkdtempSync(join(tmpdir(), `armorial-post-commit-cleanup-${operation}-`));
  try {
    const fixture = publicationFixture(root, operation);
    const result = runCli(root, "none", {
      NODE_OPTIONS: testNodeOptions(helperFailureInjector),
      ARMORIAL_TEST_PUBLISH_HELPER_FAILURE: "post-commit-cleanup-failure",
    }, fixture.args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const summary = JSON.parse(result.stdout);
    const actual = readFileSync(join(root, fixture.target));
    assert.equal(summary[fixture.hashField], sha256(actual));
    assert.equal(summary.protectionLevel, fixture.protectionLevel);
    assert.match(String(summary.cleanupWarning), /Published output is valid/);
    const temporaryResidue = residue(root);
    assert.equal(temporaryResidue.length, 1, "a real cleanup failure must retain the disclosed private link");
    assert.deepEqual(readFileSync(join(root, temporaryResidue[0])), actual);
    if (operation === "candidate") assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    return { operation, status: "published-with-cleanup-warning", sha256: summary[fixture.hashField], protectionLevel: summary.protectionLevel };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function exercisePostCommitInterruption(operation, failure) {
  const root = mkdtempSync(join(tmpdir(), `armorial-post-commit-interruption-${operation}-${failure}-`));
  try {
    const fixture = publicationFixture(root, operation);
    const result = runCli(root, "none", {
      NODE_OPTIONS: testNodeOptions(helperFailureInjector),
      ARMORIAL_TEST_PUBLISH_HELPER_FAILURE: failure,
    }, fixture.args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    const error = JSON.parse(result.stderr).error;
    assert.equal(error?.code, "PUBLICATION_OUTCOME_UNCERTAIN");
    assert.match(String(error?.message), /already authorized; inspect the destination before retrying/);
    const actual = readFileSync(join(root, fixture.target));
    if (fixture.original !== undefined) {
      assert.equal(actual.equals(fixture.original), false, "post-commit interruption must exercise a real replacement");
    }
    if (operation === "candidate") assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    assert.deepEqual(residue(root), []);
    return { operation, failure, status: "published-without-summary+uncertain-error" };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const swaps = [];
for (const operation of ["candidate", "svg", "inline"]) {
  for (const mode of ["before-spawn", "after-cwd-pin"]) swaps.push(exerciseSwap(operation, mode));
}
const helperFailures = [
  exerciseHelperFailure("candidate", "exit-before-write"),
  exerciseHelperFailure("candidate", "open-failure"),
  exerciseHelperFailure("candidate", "partial-write"),
  exerciseHelperFailure("candidate", "partial-write-cleanup-failure"),
  ...["svg-create", "svg-replace", "candidate", "legacy-replace"].map((operation) => exerciseHelperFailure(operation, "close-failure")),
];
const publicationSuccesses = ["svg-create", "svg-replace", "candidate", "legacy-replace"].map(exercisePublicationSuccess);
const postCommitCleanupWarnings = ["svg-create", "candidate"].map(exercisePostCommitCleanupWarning);
const postCommitInterruptions = ["exit-after-publication", "throw-after-publication"].flatMap((failure) =>
  ["svg-create", "svg-replace", "candidate", "legacy-replace"].map((operation) =>
    exercisePostCommitInterruption(operation, failure)));
const svgOverwrite = exerciseSvgOverwriteBoundary();
const restrictiveUmask = exerciseRestrictiveUmask();
const productionTestHooks = exerciseNoProductionTestHooks();

process.stdout.write(`${JSON.stringify({ status: "ok", cli, swaps, helperFailures, publicationSuccesses, postCommitCleanupWarnings, postCommitInterruptions, svgOverwrite, restrictiveUmask, productionTestHooks })}\n`);
