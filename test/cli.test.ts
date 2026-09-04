import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, link, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxImport = import.meta.resolve("tsx");
const inlineConflictInjector = resolve(workspace, "scripts/inject-inline-conflict.mjs");

function testNodeOptions(modulePath: string): string {
  const option = `--import=${pathToFileURL(modulePath).href}`;
  return process.env.NODE_OPTIONS === undefined ? option : `${process.env.NODE_OPTIONS} ${option}`;
}

function runCliAt(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, ["--import", tsxImport, resolve(workspace, "src/adapters/cli.ts"), ...args], {
    cwd,
    encoding: "utf8",
  });
}

function runCli(...args: string[]) {
  return runCliAt(workspace, ...args);
}

function runInlineConflictCli(
  cwd: string,
  target: string,
  externalContent: Buffer,
  method: "in-place" | "replace",
) {
  return spawnSync(process.execPath, [
    "--import",
    tsxImport,
    resolve(workspace, "src/adapters/cli.ts"),
    "batch",
    "icon-park:search",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
    "--format",
    "json",
  ], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ARMORIAL_INLINE_CONFLICT_TARGET: target,
      ARMORIAL_INLINE_CONFLICT_CONTENT_BASE64: externalContent.toString("base64"),
      ARMORIAL_INLINE_CONFLICT_METHOD: method,
      NODE_OPTIONS: testNodeOptions(inlineConflictInjector),
    },
  });
}

test("CLI validates policy and renders SVG without writing a file", () => {
  const validation = runCli("policy", "validate", "icon-policy.example.json");
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(JSON.parse(validation.stdout).status, "ok");

  const render = runCli("get", "icon-park:search", "--format", "svg");
  assert.equal(render.status, 0, render.stderr);
  assert.match(render.stdout, /^<\?xml version=/);
  assert.match(render.stdout, /<svg width="24" height="24"/);
});

test("CLI can resolve to compact text without placing SVG in Agent context", () => {
  const result = runCli("resolve", "facebook", "--format", "text");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^icon-park:facebook selected by /);
  assert.doesNotMatch(result.stdout, /<svg|<path/);
});

test("CLI emits a deterministic exact-id sprite for direct automation", () => {
  const args = [
    "batch",
    "icon-park:user",
    "icon-park:search",
    "--format",
    "sprite",
    "--symbol-prefix",
    "i-",
  ];
  const first = runCli(...args);
  const second = runCli(...args);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="0" height="0"/);
  assert.match(first.stdout, /<symbol id="i-user" viewBox="0 0 48 48" fill="none">/);
  assert.match(first.stdout, /<symbol id="i-search" viewBox="0 0 48 48" fill="none">/);
  assert.doesNotMatch(first.stdout, /<\?xml|<symbol[^>]+xmlns=|<svg width="24"/);

  const single = runCli("get", "icon-park:user", "--format", "svg");
  assert.equal(single.status, 0, single.stderr);
  const singleGeometry = single.stdout.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
  const spriteGeometry = first.stdout.match(/<symbol id="i-user"[^>]*>([\s\S]*?)<\/symbol>/)?.[1];
  assert.equal(spriteGeometry, singleGeometry, "sprite generation must preserve provider geometry byte-for-byte");
});

test("CLI creates a sprite exclusively and discloses an explicit optimistic replacement", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-output-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  await mkdir(resolve(scratch, "generated"));
  const script = resolve(workspace, "src/adapters/cli.ts");
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    script,
    "batch",
    "icon-park:user",
    "icon-park:search",
    "--format",
    "sprite",
    "--symbol-prefix",
    "i-",
    "--output",
    "generated/icons.svg",
  ], { cwd: scratch, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /<svg|<symbol|<path/);
  const summary = JSON.parse(result.stdout) as {
    status: string;
    kind: string;
    output: string;
    bytes: number;
    sha256: string;
    protectionLevel: string;
    symbols: number;
  };
  assert.deepEqual({ status: summary.status, kind: summary.kind, output: summary.output, symbols: summary.symbols }, {
    status: "ok",
    kind: "icon_sprite_file",
    output: "generated/icons.svg",
    symbols: 2,
  });
  assert.match(summary.sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(summary.protectionLevel, "non_overwriting_create");
  assert.equal((await stat(resolve(scratch, "generated/icons.svg"))).mode & 0o777, 0o644 & ~process.umask());
  const sprite = await readFile(resolve(scratch, "generated/icons.svg"), "utf8");
  assert.equal(Buffer.byteLength(sprite), summary.bytes);
  assert.match(sprite, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="0" height="0"/);
  assert.match(sprite, /<symbol id="i-user"/);
  assert.match(sprite, /<symbol id="i-search"/);

  await writeFile(resolve(scratch, "generated/icons.svg"), "stale", "utf8");
  await chmod(resolve(scratch, "generated/icons.svg"), 0o640);
  const deniedReplacement = spawnSync(process.execPath, [
    "--import", tsxImport, script, "batch", "user", "--format", "sprite", "--output", "generated/icons.svg",
  ], { cwd: scratch, encoding: "utf8" });
  assert.equal(deniedReplacement.status, 2, deniedReplacement.stderr);
  assert.match(deniedReplacement.stderr, /allow-optimistic-overwrite/);
  assert.equal(await readFile(resolve(scratch, "generated/icons.svg"), "utf8"), "stale");

  const replacement = spawnSync(process.execPath, [
    "--import", tsxImport, script, "batch", "user", "--format", "sprite", "--output", "generated/icons.svg",
    "--allow-optimistic-overwrite",
  ], { cwd: scratch, encoding: "utf8" });
  assert.equal(replacement.status, 0, replacement.stderr);
  const replacementSummary = JSON.parse(replacement.stdout) as Record<string, unknown>;
  assert.equal(replacementSummary["protectionLevel"], "optimistic_preflight_only");
  assert.match(String(replacementSummary["concurrencyWarning"]), /final check and before atomic rename/);
  assert.doesNotMatch(await readFile(resolve(scratch, "generated/icons.svg"), "utf8"), /stale/);
  assert.equal((await stat(resolve(scratch, "generated/icons.svg"))).mode & 0o777, 0o640);

  const unicodeName = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--format",
    "sprite",
    "--output",
    "generated/图标.svg",
  );
  assert.equal(unicodeName.status, 0, unicodeName.stderr);
  assert.match(await readFile(resolve(scratch, "generated/图标.svg"), "utf8"), /<symbol id="armorial-search"/);
});

test("CLI explicit optimistic mode inlines an opaque sprite with the final race disclosed", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-inline-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const target = resolve(scratch, "index.html");
  const original = "\uFEFF<!doctype html>\n<html><head><title>Fixture 检查</title></head><body class=\"app\"><main>Keep me ©</main><script>window.fixture = true;</script></body></html>\n";
  await writeFile(target, original, "utf8");
  await chmod(target, 0o600);

  const args = [
    "batch",
    "icon-park:user",
    "icon-park:search",
    "--format",
    "sprite",
    "--symbol-prefix",
    "i-",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
  ];
  const first = runCliAt(scratch, ...args);
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout, /<svg|<symbol|<path/);
  const firstSummary = JSON.parse(first.stdout) as {
    status: string;
    kind: string;
    output: string;
    bytes: number;
    sha256: string;
    sourceSha256: string;
    candidateSha256: string;
    protectionLevel: string;
    concurrencyWarning: string;
    symbols: number;
  };
  assert.deepEqual({
    status: firstSummary.status,
    kind: firstSummary.kind,
    output: firstSummary.output,
    symbols: firstSummary.symbols,
  }, {
    status: "ok",
    kind: "icon_sprite_inline",
    output: "index.html",
    symbols: 2,
  });
  const inlined = await readFile(target, "utf8");
  assert.match(inlined, /^\uFEFF<!doctype html>/, "a leading UTF-8 BOM must remain byte-aligned around the splice");
  assert.equal(Buffer.byteLength(inlined), firstSummary.bytes);
  assert.match(firstSummary.sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(firstSummary.sourceSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(firstSummary.candidateSha256, firstSummary.sha256);
  assert.equal(firstSummary.protectionLevel, "optimistic_preflight_only");
  assert.match(firstSummary.concurrencyWarning, /final check and before atomic rename/);
  assert.match(inlined, /<body class="app">\n  <!-- armorial:sprite:start -->/);
  assert.match(inlined, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(inlined, /<symbol id="i-user"/);
  assert.match(inlined, /<symbol id="i-search"/);
  assert.match(inlined, /<title>Fixture 检查<\/title>/);
  assert.match(inlined, /<!-- armorial:sprite:end -->\n<main>Keep me ©<\/main>/);
  assert.match(inlined, /<script>window\.fixture = true;<\/script>/);
  assert.equal((await stat(target)).mode & 0o777, 0o600, "atomic replacement must preserve task-file permissions");

  const second = runCliAt(scratch, ...args);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(target, "utf8"), inlined, "repeating an exact inline batch must be idempotent");
  assert.equal((inlined.match(/armorial:sprite:start/g) ?? []).length, 1);
  assert.equal(JSON.parse(second.stdout).sha256, firstSummary.sha256);

  const accidentalSubset = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--format",
    "sprite",
    "--symbol-prefix",
    "i-",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(accidentalSubset.status, 2, accidentalSubset.stderr);
  assert.equal(JSON.parse(accidentalSubset.stderr).error.code, "INVALID_INPUT");
  assert.match(accidentalSubset.stderr, /would remove 1 existing Armorial symbols \(i-search\)/);
  assert.equal(await readFile(target, "utf8"), inlined, "a subset replacement must fail before mutation");

  const intentionalSubset = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--format",
    "sprite",
    "--symbol-prefix",
    "i-",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
    "--allow-symbol-removal",
  );
  assert.equal(intentionalSubset.status, 0, intentionalSubset.stderr);
  const reduced = await readFile(target, "utf8");
  assert.match(reduced, /<symbol id="i-user"/);
  assert.doesNotMatch(reduced, /<symbol id="i-search"/);
});

test("CLI defaults to a create-only inline candidate and preserves source and existing outputs", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-inline-candidate-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const source = resolve(scratch, "index.html");
  const original = Buffer.from("<!doctype html><html><body><main>Keep me</main></body></html>\n", "utf8");
  await writeFile(source, original);
  await chmod(source, 0o600);

  const candidate = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--inline-from",
    "index.html",
    "--output",
    "index.armorial.html",
    "--format",
    "json",
  );
  assert.equal(candidate.status, 0, candidate.stderr);
  assert.deepEqual(await readFile(source), original, "candidate generation must never mutate its source");
  const candidateBytes = await readFile(resolve(scratch, "index.armorial.html"));
  assert.equal((await stat(resolve(scratch, "index.armorial.html"))).mode & 0o777, 0o600);
  assert.match(candidateBytes.toString("utf8"), /<symbol id="armorial-search"/);
  const summary = JSON.parse(candidate.stdout) as Record<string, unknown>;
  assert.equal(summary["kind"], "icon_sprite_inline_candidate");
  assert.equal(summary["source"], "index.html");
  assert.equal(summary["output"], "index.armorial.html");
  assert.equal(summary["protectionLevel"], "non_overwriting_candidate");
  assert.match(String(summary["sourceSha256"]), /^sha256:[a-f0-9]{64}$/);
  assert.match(String(summary["candidateSha256"]), /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(candidate.stdout, /<svg|<symbol|<path/);

  const optimisticDenied = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--inline-into",
    "index.html",
    "--format",
    "json",
  );
  assert.equal(optimisticDenied.status, 2);
  assert.match(optimisticDenied.stderr, /allow-optimistic-overwrite/);
  assert.deepEqual(await readFile(source), original);

  const candidateOptimisticDenied = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--inline-from",
    "index.html",
    "--output",
    "candidate-with-optimistic-flag.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(candidateOptimisticDenied.status, 2);
  assert.match(candidateOptimisticDenied.stderr, /HTML candidates remain create-only/);
  assert.deepEqual(await readFile(source), original);
  await assert.rejects(() => readFile(resolve(scratch, "candidate-with-optimistic-flag.html")), { code: "ENOENT" });

  const existing = Buffer.from("EXISTING-CANDIDATE\n", "utf8");
  await writeFile(resolve(scratch, "existing.html"), existing);
  const existingDenied = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--inline-from",
    "index.html",
    "--output",
    "existing.html",
  );
  assert.equal(existingDenied.status, 2);
  assert.deepEqual(await readFile(source), original);
  assert.deepEqual(await readFile(resolve(scratch, "existing.html")), existing);

  const samePath = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--inline-from",
    "index.html",
    "--output",
    "index.html",
  );
  assert.equal(samePath.status, 2);
  assert.match(samePath.stderr, /different from its source/);
  assert.deepEqual(await readFile(source), original);

  await link(source, resolve(scratch, "alias.html"));
  const hardLinkAlias = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--inline-from",
    "index.html",
    "--output",
    "alias.html",
  );
  assert.equal(hardLinkAlias.status, 2);
  assert.match(hardLinkAlias.stderr, /hard-link alias/);
  assert.deepEqual(await readFile(source), original);
  assert.deepEqual(await readFile(resolve(scratch, "alias.html")), original);

  const invalidSource = resolve(scratch, "invalid.html");
  const invalidBytes = Buffer.from("<main>missing explicit body</main>\n", "utf8");
  await writeFile(invalidSource, invalidBytes);
  const failedCandidate = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--inline-from",
    "invalid.html",
    "--output",
    "never-created.html",
  );
  assert.equal(failedCandidate.status, 2);
  const failedCandidateError = JSON.parse(failedCandidate.stderr) as { error?: { field?: unknown; message?: unknown } };
  assert.equal(failedCandidateError.error?.field, "inline-from");
  assert.match(String(failedCandidateError.error?.message), /^inline-from HTML/);
  assert.deepEqual(await readFile(invalidSource), invalidBytes);
  await assert.rejects(() => readFile(resolve(scratch, "never-created.html")), { code: "ENOENT" });
});

test("CLI pins publication to the admitted parent inode across directory replacement", () => {
  const result = spawnSync(process.execPath, [
    resolve(workspace, "scripts/probe-pinned-publication.mjs"),
    "--cli",
    resolve(workspace, "src/adapters/cli.ts"),
  ], { cwd: workspace, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const observation = JSON.parse(result.stdout) as {
    status?: unknown;
    swaps?: Array<{ status?: unknown }>;
    helperFailures?: Array<{ status?: unknown }>;
    publicationSuccesses?: Array<{ status?: unknown }>;
    postCommitCleanupWarnings?: Array<{ status?: unknown }>;
    postCommitInterruptions?: Array<{ status?: unknown }>;
  };
  assert.equal(observation.status, "ok");
  assert.equal(observation.swaps?.length, 6);
  assert.equal(observation.swaps?.every(({ status }) => ["closed-before-write", "published-to-pinned-inode"].includes(String(status))), true);
  assert.equal(observation.helperFailures?.length, 8);
  assert.equal(observation.helperFailures?.every(({ status }) => status === "closed-without-final-effect"), true);
  assert.equal(observation.publicationSuccesses?.every(({ status }) => status === "published-with-truthful-summary"), true);
  assert.equal(observation.postCommitCleanupWarnings?.every(({ status }) => status === "published-with-cleanup-warning"), true);
  assert.equal(observation.postCommitInterruptions?.every(({ status }) => status === "published-without-summary+uncertain-error"), true);
});

test("CLI preserves same-size external HTML saves before inline publication", async (context) => {
  for (const method of ["in-place", "replace"] as const) {
    const scratch = await mkdtemp(resolve(tmpdir(), `armorial-cli-inline-conflict-${method}-`));
    context.after(() => rm(scratch, { recursive: true, force: true }));
    const target = resolve(scratch, "index.html");
    const original = Buffer.from("<!doctype html><html><body><main>ORIGINAL-01</main></body></html>\n", "utf8");
    const external = Buffer.from("<!doctype html><html><body><main>EXTERNAL-01</main></body></html>\n", "utf8");
    assert.equal(external.byteLength, original.byteLength);
    await writeFile(target, original);
    const before = await stat(target, { bigint: true });

    const result = runInlineConflictCli(scratch, target, external, method);

    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    const failure = JSON.parse(result.stderr) as {
      status?: unknown;
      error?: {
        code?: unknown;
        message?: unknown;
        field?: unknown;
        publication?: unknown;
      };
    };
    assert.deepEqual(failure, {
      status: "error",
      error: {
        code: "INVALID_INPUT",
        message: "inline-into HTML changed after Armorial read it; the external version was preserved. Retry with a stable task file.",
        field: "inline-into",
        publication: {
          effect: "none",
          cleanup: { status: "complete" },
        },
      },
    });
    assert.deepEqual(await readFile(target), external, `${method} external content must survive`);
    const after = await stat(target, { bigint: true });
    if (method === "in-place") assert.equal(after.ino, before.ino, "the fixture must exercise an in-place save");
    else assert.notEqual(after.ino, before.ino, "the fixture must exercise a replacement inode");
    assert.deepEqual(
      (await readdir(scratch)).filter((name) => name.includes(".armorial-") && name.endsWith(".tmp")),
      [],
      "a failed optimistic publication must clean its temporary file",
    );
  }
});

test("CLI keeps an exact 8 MiB caller carrier admissible after insert, retry, and replacement", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-inline-maximum-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const target = resolve(scratch, "maximum.html");
  const callerLimit = 8 * 1024 * 1024;
  const prefix = Buffer.from("<!doctype html><html><head><title>maximum</title></head><body><main>", "utf8");
  const suffix = Buffer.from("</main></body></html>\n", "utf8");
  const original = Buffer.concat([
    prefix,
    Buffer.alloc(callerLimit - prefix.byteLength - suffix.byteLength, 0x78),
    suffix,
  ]);
  await writeFile(target, original);

  const first = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--inline-into",
    "maximum.html",
    "--allow-optimistic-overwrite",
    "--format",
    "json",
  );
  assert.equal(first.status, 0, first.stderr);
  const firstBytes = await readFile(target);
  assert.ok(firstBytes.byteLength > callerLimit, "the managed block is separately bounded from caller HTML");
  assert.match(firstBytes.toString("utf8"), /<symbol id="armorial-search"/);

  const retry = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--inline-into",
    "maximum.html",
    "--allow-optimistic-overwrite",
    "--format",
    "json",
  );
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(await readFile(target), firstBytes, "an exact retry must preserve the full physical carrier");

  const replacement = runCliAt(
    scratch,
    "batch",
    "icon-park:user",
    "--inline-into",
    "maximum.html",
    "--allow-optimistic-overwrite",
    "--format",
    "json",
    "--allow-symbol-removal",
  );
  assert.equal(replacement.status, 0, replacement.stderr);
  const replacementBytes = await readFile(target);
  assert.ok(replacementBytes.byteLength > callerLimit);
  assert.match(replacementBytes.toString("utf8"), /<symbol id="armorial-user"/);
  assert.doesNotMatch(replacementBytes.toString("utf8"), /<symbol id="armorial-search"/);

  const oversizedTarget = resolve(scratch, "oversized.html");
  const oversized = Buffer.concat([original.subarray(0, original.byteLength - suffix.byteLength), Buffer.from("x"), suffix]);
  await writeFile(oversizedTarget, oversized);
  const rejected = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--inline-into",
    "oversized.html",
    "--allow-optimistic-overwrite",
    "--format",
    "json",
  );
  assert.equal(rejected.status, 2, rejected.stderr);
  assert.equal(rejected.stdout, "");
  assert.equal(JSON.parse(rejected.stderr).error.code, "INVALID_INPUT");
  assert.deepEqual(await readFile(oversizedTarget), oversized, "an oversized first insert must fail before mutation");

  const oversizedBlockTarget = resolve(scratch, "oversized-block.html");
  const oversizedBlock = [
    "<!doctype html><html><body>",
    "  <!-- armorial:sprite:start -->",
    ...Array.from({ length: 3 }, () => `<!--${"界".repeat(60_000)}-->`),
    "  <!-- armorial:sprite:end -->",
    "</body></html>",
  ].join("\n");
  assert.ok(Buffer.byteLength(oversizedBlock, "utf8") > 512 * 1024);
  await writeFile(oversizedBlockTarget, oversizedBlock, "utf8");
  const oversizedBlockResult = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--inline-into",
    "oversized-block.html",
    "--allow-optimistic-overwrite",
    "--format",
    "json",
  );
  assert.equal(oversizedBlockResult.status, 2, oversizedBlockResult.stderr);
  assert.equal(oversizedBlockResult.stdout, "");
  assert.match(oversizedBlockResult.stderr, /sprite block must not exceed 524288 bytes/);
  assert.equal(await readFile(oversizedBlockTarget, "utf8"), oversizedBlock);
});

test("CLI inline parser accepts one explicit body and rejects pseudo, missing, or ambiguous bodies without mutation", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-inline-parser-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));

  const validTarget = resolve(scratch, "valid.html");
  const validOriginal = [
    "<!doctype html>",
    "<HTML><HEAD><!-- template text: <body>; armorial:sprite:start; armorial:sprite:end --><script>",
    'const fakeBody = "<body>";',
    'const fakeMarkers = "<!-- armorial:sprite:start --><!-- armorial:sprite:end -->";',
    "</script></HEAD><BoDy class=\"app\" data-fixture=\"kept\"><main>Keep me</main></BoDy></HTML>",
    "",
  ].join("\n");
  await writeFile(validTarget, validOriginal, "utf8");
  const valid = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--format",
    "sprite",
    "--inline-into",
    "valid.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(valid.status, 0, valid.stderr);
  const inlined = await readFile(validTarget, "utf8");
  assert.match(inlined, /^<!doctype html>\n<HTML><HEAD><!-- template text: <body>; armorial:sprite:start; armorial:sprite:end --><script>/);
  assert.match(inlined, /const fakeBody = "<body>";/);
  assert.match(inlined, /<BoDy class="app" data-fixture="kept">\n  <!-- armorial:sprite:start -->/);
  assert.match(inlined, /<symbol id="armorial-search"/);
  assert.match(inlined, /<!-- armorial:sprite:end -->\n<main>Keep me<\/main>/);

  const repeat = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--format",
    "sprite",
    "--inline-into",
    "valid.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(await readFile(validTarget, "utf8"), inlined, "script marker text must not create duplicate blocks");

  const invalidFixtures = new Map<string, string | Buffer>([
    [
      "script-pseudo-body.html",
      '<!doctype html><html><head><script>const template = "<body>";</script></head></html>\n',
    ],
    ["missing-body.html", "<!doctype html><html><head></head><main>implicit body only</main></html>\n"],
    ["ambiguous-body.html", "<!doctype html><html><body>first<body data-second>second</body></html>\n"],
    ["self-closing-body.html", "<!doctype html><html><body/><main>ambiguous body</main></html>\n"],
    [
      "head-marker-block.html",
      "<!doctype html><html><head><!-- armorial:sprite:start --><!-- armorial:sprite:end --></head><body><main>keep</main></body></html>\n",
    ],
    [
      "html-root-marker-block.html",
      "<!doctype html><html><!-- armorial:sprite:start --><!-- armorial:sprite:end --><head></head><body><main>keep</main></body></html>\n",
    ],
    [
      "trailing-marker-block.html",
      "<!doctype html><html><head></head><body><main>keep</main></body><!-- armorial:sprite:start --><!-- armorial:sprite:end --></html>\n",
    ],
    [
      "inert-marker-block.html",
      "<!doctype html><html><body><template><!-- armorial:sprite:start --><svg></svg><!-- armorial:sprite:end --></template></body></html>\n",
    ],
    ["invalid-utf8.html", Buffer.from([0x3c, 0x62, 0x6f, 0x64, 0x79, 0x3e, 0xff, 0x3c, 0x2f, 0x62, 0x6f, 0x64, 0x79, 0x3e])],
    ["oversized.html", Buffer.alloc((8 * 1024 * 1024) + 1, 0x78)],
  ]);
  for (const [fileName, source] of invalidFixtures) {
    const target = resolve(scratch, fileName);
    await writeFile(target, source);
    const before = await readFile(target);
    const result = runCliAt(
      scratch,
      "batch",
      "icon-park:search",
      "--format",
      "sprite",
      "--inline-into",
      fileName,
      "--allow-optimistic-overwrite",
    );
    assert.equal(result.status, 2, `${fileName}\n${result.stderr}`);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, "INVALID_INPUT");
    assert.deepEqual(await readFile(target), before, `${fileName} must remain byte-identical on failure`);
  }
});

test("CLI inline output rejects unsafe paths, conflicting carriers, and malformed HTML", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-inline-safety-"));
  const outside = await mkdtemp(resolve(tmpdir(), "armorial-cli-inline-outside-"));
  context.after(async () => {
    await rm(scratch, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(resolve(scratch, "plain.txt"), "<body></body>", "utf8");
  await writeFile(resolve(scratch, "no-body.html"), "<main>missing body</main>", "utf8");
  await writeFile(resolve(scratch, "broken.html"), "<body><!-- armorial:sprite:start --></body>", "utf8");
  await symlink(resolve(outside, "outside.html"), resolve(scratch, "escape.html"));
  await writeFile(resolve(outside, "outside.html"), "<body></body>", "utf8");

  const cases = [
    ["--inline-into", resolve(scratch, "absolute.html")],
    ["--inline-into", "missing.html"],
    ["--inline-into", "plain.txt"],
    ["--inline-into", "escape.html"],
    ["--inline-into", "no-body.html"],
    ["--inline-into", "broken.html"],
    ["--inline-into", "no-body.html", "--output", "icons.svg"],
    ["--output", "icons.svg", "--allow-symbol-removal"],
  ];
  for (const extra of cases) {
    const result = runCliAt(
      scratch,
      "batch",
      "user",
      "--format",
      "sprite",
      ...extra,
      ...(extra[0] === "--inline-into" ? ["--allow-optimistic-overwrite"] : []),
    );
    assert.equal(result.status, 2, `${extra.join(" ")}\n${result.stderr}`);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, "INVALID_INPUT");
  }
});

test("CLI sprite file output rejects absolute, non-SVG, and symlink escape paths", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-output-safety-"));
  const outside = await mkdtemp(resolve(tmpdir(), "armorial-cli-output-outside-"));
  context.after(async () => {
    await rm(scratch, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await symlink(outside, resolve(scratch, "escape"));
  const script = resolve(workspace, "src/adapters/cli.ts");
  for (const output of [resolve(scratch, "absolute.svg"), "icons.html", "missing/icons.svg", "escape/icons.svg", "portable\\icons.svg"]) {
    const result = spawnSync(process.execPath, [
      "--import", tsxImport, script, "batch", "user", "--format", "sprite", "--output", output,
    ], { cwd: scratch, encoding: "utf8" });
    assert.equal(result.status, 2, `${output}\n${result.stderr}`);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, "INVALID_INPUT");
  }
});

test("CLI sprite output closes invalid prefixes, duplicates, and partial batches", () => {
  for (const args of [
    ["batch", "user", "--format", "sprite", "--symbol-prefix", "../"],
    ["batch", "user", "user", "--format", "sprite"],
    ["batch", "user", "not-an-armorial-icon", "--format", "sprite"],
  ]) {
    const result = runCli(...args);
    assert.equal(result.status, 2, `${args.join(" ")}\n${result.stderr}`);
    assert.equal(result.stdout, "");
    assert.doesNotThrow(() => JSON.parse(result.stderr));
  }
});

test("CLI batch carriers infer sprite format and batch help avoids kernel work", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-inferred-sprite-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  await writeFile(resolve(scratch, "index.html"), "<body><svg><use href=\"#armorial-user\"/></svg></body>\n", "utf8");

  const output = runCliAt(scratch, "batch", "user", "--output", "icons.svg");
  assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(output.stdout).kind, "icon_sprite_file");
  assert.match(await readFile(resolve(scratch, "icons.svg"), "utf8"), /<symbol id="armorial-user"/);

  const inline = runCliAt(
    scratch,
    "batch",
    "user",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(inline.status, 0, inline.stderr);
  assert.equal(JSON.parse(inline.stdout).kind, "icon_sprite_inline");

  const help = runCliAt(scratch, "batch", "--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--inline-into relative\.html/);
  assert.doesNotMatch(help.stdout, /<svg|<symbol|<path/);
});

test("CLI accepts a JSON summary request with an unambiguous sprite carrier", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-json-carrier-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const target = resolve(scratch, "index.html");
  await writeFile(target, "<body><main>Keep me</main></body>\n", "utf8");

  const result = runCliAt(
    scratch,
    "batch",
    "search",
    "settings",
    "close",
    "--resolve-intents",
    "--format",
    "json",
    "--symbol-prefix",
    "ui-",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /<svg|<symbol|<path/);
  const summary = JSON.parse(result.stdout) as {
    kind: string;
    symbols: number;
    resolved: Array<{ intent: string; id: string }>;
  };
  assert.equal(summary.kind, "icon_sprite_inline");
  assert.equal(summary.symbols, 3);
  assert.deepEqual(summary.resolved, [
    { intent: "search", id: "icon-park:search" },
    { intent: "settings", id: "icon-park:setting" },
    { intent: "close", id: "icon-park:close" },
  ]);
  const html = await readFile(target, "utf8");
  assert.match(html, /<symbol id="ui-search"/);
  assert.match(html, /<symbol id="ui-setting"/);
  assert.match(html, /<symbol id="ui-close"/);

  const incompatible = runCliAt(
    scratch,
    "batch",
    "search",
    "--format",
    "text",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(incompatible.status, 2, incompatible.stderr);
  assert.equal(JSON.parse(incompatible.stderr).error.code, "INVALID_INPUT");
  assert.equal(await readFile(target, "utf8"), html);
});

test("CLI render flags preserve the shared typed override across resolve, get, and batch", async (context) => {
  const renderArgs = [
    "--theme", "two-tone",
    "--size", "32",
    "--stroke-width", "2",
    "--stroke-linecap", "square",
    "--stroke-linejoin", "bevel",
    "--primary", "#112233",
    "--secondary", "rebeccapurple",
    "--inner-stroke", "var(--icon-stroke)",
    "--inner-fill", "transparent",
  ];
  const resolved = runCli("resolve", "search", "--alternatives", "0", "--format", "json", ...renderArgs);
  assert.equal(resolved.status, 0, resolved.stderr);
  const resolvedIcon = JSON.parse(resolved.stdout).icon;
  assert.deepEqual(resolvedIcon.policy, {
    theme: "two-tone",
    size: 32,
    strokeWidth: 2,
    strokeLinecap: "square",
    strokeLinejoin: "bevel",
    colors: {
      primary: "#112233",
      secondary: "rebeccapurple",
      innerStroke: "var(--icon-stroke)",
      innerFill: "transparent",
    },
    context: null,
  });
  assert.equal(resolvedIcon.policyCompliance, "overridden");

  const exact = runCli("get", "icon-park:search", "--format", "json", ...renderArgs);
  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(JSON.parse(exact.stdout).icon.asset.sha256, resolvedIcon.asset.sha256);

  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-render-carrier-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const spriteRenderArgs = [
    "--theme", "two-tone",
    "--stroke-width", "2",
    "--stroke-linecap", "square",
    "--stroke-linejoin", "bevel",
    "--primary", "#112233",
    "--secondary", "rebeccapurple",
    "--inner-stroke", "var(--icon-stroke)",
    "--inner-fill", "transparent",
  ];
  const output = runCliAt(
    scratch,
    "batch",
    "icon-park:search",
    "--format",
    "json",
    "--output",
    "icons.svg",
    ...spriteRenderArgs,
  );
  assert.equal(output.status, 0, output.stderr);
  const sprite = await readFile(resolve(scratch, "icons.svg"), "utf8");
  assert.match(sprite, /stroke-width="2"/);
  assert.match(sprite, /#112233/);

  for (const invalid of [
    ["--size", "32"],
    ["--size", "7"],
    ["--stroke-width", "2.5"],
    ["--theme", "duotone"],
    ["--primary", "url(https://example.com/icon.svg)"],
  ]) {
    const failure = runCliAt(
      scratch,
      "batch",
      "icon-park:search",
      "--format",
      "json",
      "--output",
      "icons.svg",
      ...invalid,
    );
    assert.equal(failure.status, 2, `${invalid.join(" ")}\n${failure.stderr}`);
    assert.equal(JSON.parse(failure.stderr).error.code, "INVALID_INPUT");
    assert.equal(await readFile(resolve(scratch, "icons.svg"), "utf8"), sprite);
  }
});

test("CLI resolves a bounded intent set and writes one compact sprite carrier atomically", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-intent-batch-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const target = resolve(scratch, "index.html");
  await writeFile(target, "<body><main>Keep me</main></body>\n", "utf8");

  const result = runCliAt(
    scratch,
    "batch",
    "user",
    "search",
    "facebook",
    "instagram",
    "tiktok",
    "--resolve-intents",
    "--symbol-prefix",
    "i-",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /<svg|<symbol|<path/);
  const summary = JSON.parse(result.stdout) as {
    kind: string;
    symbols: number;
    resolved: Array<{ intent: string; id: string }>;
  };
  assert.equal(summary.kind, "icon_sprite_inline");
  assert.equal(summary.symbols, 5);
  assert.deepEqual(summary.resolved, [
    { intent: "user", id: "icon-park:user" },
    { intent: "search", id: "icon-park:search" },
    { intent: "facebook", id: "icon-park:facebook" },
    { intent: "instagram", id: "icon-park:instagram" },
    { intent: "tiktok", id: "icon-park:tiktok" },
  ]);
  const html = await readFile(target, "utf8");
  assert.match(html, /<symbol id="i-user"/);
  assert.match(html, /<symbol id="i-tiktok"/);
  assert.match(html, /<main>Keep me<\/main>/);
});

test("CLI resolves multiple intents once without rendering or publishing a carrier", () => {
  const result = runCli(
    "batch",
    "user",
    "search",
    "user",
    "--resolve-intents",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /<svg|<symbol|<path|asset/);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "ok",
    kind: "icon_intent_batch",
    summary: { requested: 3, resolved: 3, uniqueIcons: 2 },
    items: [
      { index: 0, intent: "user", id: "icon-park:user" },
      { index: 1, intent: "search", id: "icon-park:search" },
      { index: 2, intent: "user", id: "icon-park:user" },
    ],
  });

  const text = runCli("batch", "user", "search", "--resolve-intents", "--format", "text");
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, "0\t\"user\"\ticon-park:user\n1\t\"search\"\ticon-park:search\n");
});

test("CLI intent batch fails before mutation on ambiguity, misses, or an unbounded carrier", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-intent-batch-failure-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const target = resolve(scratch, "index.html");
  const original = "<body><main>Keep me</main></body>\n";
  await writeFile(target, original, "utf8");

  const unresolved = runCliAt(
    scratch,
    "batch",
    "user",
    "设置",
    "我要一个图标",
    "--resolve-intents",
    "--inline-into",
    "index.html",
    "--allow-optimistic-overwrite",
  );
  assert.equal(unresolved.status, 2, unresolved.stderr);
  assert.equal(unresolved.stdout, "");
  const summary = JSON.parse(unresolved.stderr) as {
    kind: string;
    resolved: Array<{ intent: string; id: string }>;
    unresolved: Array<{ index: number; intent: string; code: string; candidates?: string[] }>;
  };
  assert.equal(summary.kind, "icon_intent_batch");
  assert.deepEqual(summary.resolved, [{ intent: "user", id: "icon-park:user" }]);
  assert.equal(summary.unresolved.length, 2);
  assert.deepEqual(summary.unresolved.map(({ index, intent, code }) => ({ index, intent, code })), [
    { index: 1, intent: "设置", code: "ICON_AMBIGUOUS" },
    { index: 2, intent: "我要一个图标", code: "ICON_NOT_FOUND" },
  ]);
  assert.ok((summary.unresolved[0]?.candidates?.length ?? 0) >= 2);
  assert.equal(await readFile(target, "utf8"), original);

  const unboundedSprite = runCliAt(scratch, "batch", "user", "--resolve-intents", "--format", "sprite");
  assert.equal(unboundedSprite.status, 2, unboundedSprite.stderr);
  assert.equal(unboundedSprite.stdout, "");
  assert.equal(JSON.parse(unboundedSprite.stderr).error.field, "resolve-intents");
  assert.equal(await readFile(target, "utf8"), original);
});

test("CLI returns a stable nonzero ambiguity without putting SVG on stdout", () => {
  const result = runCli("resolve", "设置", "--format", "svg");
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).status, "ambiguous");
});

test("CLI reports unknown options and missing option values as invalid input", () => {
  for (const args of [
    ["search", "settings", "--invented"],
    ["search", "settings", "--limit"],
  ]) {
    const result = runCli(...args);
    assert.equal(result.status, 2, `${args.join(" ")}\n${result.stderr}`);
    assert.equal(result.stdout, "");
    const failure = JSON.parse(result.stderr) as { status: string; error: { code: string } };
    assert.equal(failure.status, "error");
    assert.equal(failure.error.code, "INVALID_INPUT");
  }
});

test("CLI exposes the MCP server through the package-default executable", () => {
  const result = runCli("mcp", "--invented");
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  const failure = JSON.parse(result.stderr) as { status: string; error: { code: string } };
  assert.equal(failure.status, "error");
  assert.equal(failure.error.code, "INVALID_INPUT");
});
