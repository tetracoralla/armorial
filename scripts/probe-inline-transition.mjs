import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const MAX_CALLER_BYTES = 8 * 1024 * 1024;
const MAX_MANAGED_BLOCK_BYTES = 512 * 1024;
const MAX_CANONICAL_FRAMING_BYTES = 4;
const MAX_PHYSICAL_BYTES = MAX_CALLER_BYTES + MAX_MANAGED_BLOCK_BYTES + MAX_CANONICAL_FRAMING_BYTES;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function exactHtml(bytes, prefixText = "<!doctype html><html><head><title>maximum</title></head><body><main>") {
  const prefix = Buffer.from(prefixText, "utf8");
  const suffix = Buffer.from("</main></body></html>\n", "utf8");
  assert.ok(bytes >= prefix.byteLength + suffix.byteLength);
  return Buffer.concat([prefix, Buffer.alloc(bytes - prefix.byteLength - suffix.byteLength, 0x78), suffix]);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const workspace = resolve(import.meta.dirname, "..");
const cli = resolve(argument("--cli") ?? join(workspace, "dist/adapters/cli.js"));
const scratch = mkdtempSync(join(tmpdir(), "armorial-inline-transition-"));

function invoke(fileName, id, ...extra) {
  return spawnSync(process.execPath, [
    cli,
    "batch",
    id,
    "--inline-into",
    fileName,
    "--format",
    "json",
    ...extra,
  ], { cwd: scratch, encoding: "utf8", maxBuffer: 64 * 1024 });
}

try {
  const target = join(scratch, "maximum.html");
  const original = exactHtml(MAX_CALLER_BYTES);
  writeFileSync(target, original);

  const first = invoke(basename(target), "icon-park:search");
  assert.equal(first.status, 0, first.stderr);
  const firstSummary = JSON.parse(first.stdout);
  const firstBytes = readFileSync(target);
  assert.equal(firstSummary.status, "ok");
  assert.equal(firstSummary.kind, "icon_sprite_inline");
  assert.equal(firstSummary.bytes, firstBytes.byteLength);
  assert.equal(firstSummary.sha256, `sha256:${sha256(firstBytes)}`);
  assert.ok(firstBytes.byteLength > MAX_CALLER_BYTES);
  assert.ok(firstBytes.byteLength <= MAX_PHYSICAL_BYTES);
  assert.match(firstBytes.toString("utf8"), /<symbol id="armorial-search"/);

  const retry = invoke(basename(target), "icon-park:search");
  assert.equal(retry.status, 0, retry.stderr);
  const retrySummary = JSON.parse(retry.stdout);
  const retryBytes = readFileSync(target);
  assert.equal(retrySummary.sha256, firstSummary.sha256);
  assert.equal(retrySummary.bytes, firstSummary.bytes);
  assert.deepEqual(retryBytes, firstBytes, "an exact retry must preserve the complete physical carrier");

  const replacement = invoke(basename(target), "icon-park:user", "--allow-symbol-removal");
  assert.equal(replacement.status, 0, replacement.stderr);
  const replacementSummary = JSON.parse(replacement.stdout);
  const replacementBytes = readFileSync(target);
  assert.equal(replacementSummary.status, "ok");
  assert.equal(replacementSummary.kind, "icon_sprite_inline");
  assert.equal(replacementSummary.bytes, replacementBytes.byteLength);
  assert.equal(replacementSummary.sha256, `sha256:${sha256(replacementBytes)}`);
  assert.ok(replacementBytes.byteLength > MAX_CALLER_BYTES);
  assert.ok(replacementBytes.byteLength <= MAX_PHYSICAL_BYTES);
  assert.match(replacementBytes.toString("utf8"), /<symbol id="armorial-user"/);
  assert.doesNotMatch(replacementBytes.toString("utf8"), /<symbol id="armorial-search"/);

  const overTarget = join(scratch, "over.html");
  const over = exactHtml(MAX_CALLER_BYTES + 1);
  writeFileSync(overTarget, over);
  const rejected = invoke(basename(overTarget), "icon-park:search");
  assert.equal(rejected.status, 2, rejected.stderr);
  assert.equal(rejected.stdout, "");
  assert.equal(JSON.parse(rejected.stderr).error.code, "INVALID_INPUT");
  assert.deepEqual(readFileSync(overTarget), over, "an oversized first insert must fail before mutation");

  const pseudoTarget = join(scratch, "over-with-pseudo-markers.html");
  const pseudo = exactHtml(
    MAX_CALLER_BYTES + 1,
    '<!doctype html><html><head><script>const fake="<!-- armorial:sprite:start --><!-- armorial:sprite:end -->";</script></head><body><main>',
  );
  writeFileSync(pseudoTarget, pseudo);
  const pseudoRejected = invoke(basename(pseudoTarget), "icon-park:search");
  assert.equal(pseudoRejected.status, 2, pseudoRejected.stderr);
  assert.equal(pseudoRejected.stdout, "");
  assert.equal(JSON.parse(pseudoRejected.stderr).error.code, "INVALID_INPUT");
  assert.deepEqual(
    readFileSync(pseudoTarget),
    pseudo,
    "marker-looking raw text must not bypass the caller-owned byte limit",
  );

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    cli,
    contract: {
      callerBytes: MAX_CALLER_BYTES,
      managedBlockBytes: MAX_MANAGED_BLOCK_BYTES,
      canonicalFramingBytes: MAX_CANONICAL_FRAMING_BYTES,
      physicalBytes: MAX_PHYSICAL_BYTES,
    },
    transition: {
      firstBytes: firstBytes.byteLength,
      retrySha256: retrySummary.sha256,
      replacementBytes: replacementBytes.byteLength,
      replacementSha256: replacementSummary.sha256,
      overLimit: "INVALID_INPUT",
      pseudoMarkerOverLimit: "INVALID_INPUT",
    },
  })}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
