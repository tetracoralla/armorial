import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const workspace = resolve(import.meta.dirname, "..");
const defaultModule = resolve(workspace, "dist/adapters/cli-artifact.js");
const MAX_RSS_BYTES = 256 * 1024 * 1024;
const MAX_CALL_MS = 6_000;
const sizes = [
  1 * 1024 * 1024,
  4 * 1024 * 1024,
  Math.floor(7.5 * 1024 * 1024),
  8 * 1024 * 1024,
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function writeAll(handle, buffer, length = buffer.byteLength) {
  let written = 0;
  while (written < length) {
    const count = writeSync(handle, buffer, written, length - written);
    assert.ok(count > 0, "resource fixture write made no progress");
    written += count;
  }
}

if (process.argv.includes("--worker")) {
  const targetBytes = Number(argument("--bytes"));
  const modulePath = resolve(argument("--module") ?? defaultModule);
  assert.ok(Number.isSafeInteger(targetBytes) && targetBytes > 0);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "armorial-inline-resource-"));
  const previousCwd = process.cwd();
  const target = join(temporaryRoot, "large.html");
  const insertionPrefix = Buffer.from("<!doctype html><html><head><title>large</title></head><body>", "utf8");
  const payloadPrefix = Buffer.from("<main>", "utf8");
  const prefix = Buffer.concat([insertionPrefix, payloadPrefix]);
  const suffix = Buffer.from("</main></body></html>\n", "utf8");
  const textBytes = targetBytes - prefix.byteLength - suffix.byteLength;
  assert.ok(textBytes > 0);
  const handle = openSync(target, "wx", 0o600);
  try {
    writeAll(handle, prefix);
    const chunk = Buffer.alloc(Math.min(textBytes, 64 * 1024), 0x78);
    let remaining = textBytes;
    while (remaining > 0) {
      const length = Math.min(remaining, chunk.byteLength);
      writeAll(handle, chunk, length);
      remaining -= length;
    }
    writeAll(handle, suffix);
  } finally {
    closeSync(handle);
  }

  const { inlineSpriteIntoHtml } = await import(pathToFileURL(modulePath).href);
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><symbol id="armorial-search" viewBox="0 0 48 48"><path d="M1 1"/></symbol></svg>';
  const output = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    output.push(String(chunk));
    return true;
  };
  let elapsedMs;
  try {
    process.chdir(temporaryRoot);
    const startedAt = performance.now();
    await inlineSpriteIntoHtml("large.html", sprite, 1);
    elapsedMs = performance.now() - startedAt;
  } finally {
    process.chdir(previousCwd);
    process.stdout.write = originalWrite;
  }

  const summary = JSON.parse(output.join(""));
  const result = readFileSync(target);
  assert.equal(summary.status, "ok");
  assert.equal(summary.kind, "icon_sprite_inline");
  assert.equal(summary.symbols, 1);
  assert.equal(summary.bytes, result.byteLength);
  const expectedInsertion = Buffer.from(`\n  <!-- armorial:sprite:start -->\n  ${sprite}\n  <!-- armorial:sprite:end -->\n`, "utf8");
  assert.equal(result.subarray(0, insertionPrefix.byteLength).equals(insertionPrefix), true);
  assert.equal(
    result.subarray(insertionPrefix.byteLength, insertionPrefix.byteLength + expectedInsertion.byteLength).equals(expectedInsertion),
    true,
  );
  const preservedRemainder = result.subarray(insertionPrefix.byteLength + expectedInsertion.byteLength);
  assert.equal(preservedRemainder.byteLength, payloadPrefix.byteLength + textBytes + suffix.byteLength);
  assert.equal(preservedRemainder.subarray(0, payloadPrefix.byteLength).equals(payloadPrefix), true);
  assert.equal(
    preservedRemainder.subarray(payloadPrefix.byteLength, payloadPrefix.byteLength + textBytes)
      .every((byte) => byte === 0x78),
    true,
  );
  assert.equal(result.subarray(-suffix.byteLength).equals(suffix), true);
  const maxRssBytes = process.resourceUsage().maxRSS * 1024;
  rmSync(temporaryRoot, { recursive: true, force: true });
  originalWrite(`${JSON.stringify({ targetBytes, elapsedMs, maxRssBytes, outputBytes: result.byteLength })}\n`);
} else {
  const modulePath = resolve(argument("--module") ?? defaultModule);
  const observations = sizes.map((targetBytes) => {
    const result = spawnSync(process.execPath, [
      import.meta.filename,
      "--worker",
      "--bytes",
      String(targetBytes),
      "--module",
      modulePath,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const observation = JSON.parse(result.stdout);
    assert.ok(
      observation.elapsedMs <= MAX_CALL_MS,
      `${targetBytes}-byte inline call took ${observation.elapsedMs} ms (limit ${MAX_CALL_MS} ms)`,
    );
    assert.ok(
      observation.maxRssBytes <= MAX_RSS_BYTES,
      `${targetBytes}-byte inline call used ${observation.maxRssBytes} bytes max RSS (limit ${MAX_RSS_BYTES})`,
    );
    return observation;
  });
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    module: modulePath,
    maxCallMs: MAX_CALL_MS,
    maxRssBytes: MAX_RSS_BYTES,
    observations,
  })}\n`);
}
