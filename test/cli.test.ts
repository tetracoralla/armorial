import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxImport = import.meta.resolve("tsx");

function runCliAt(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, ["--import", tsxImport, resolve(workspace, "src/adapters/cli.ts"), ...args], {
    cwd,
    encoding: "utf8",
  });
}

function runCli(...args: string[]) {
  return runCliAt(workspace, ...args);
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

test("CLI writes a sprite atomically and returns only a compact integrity summary", async (context) => {
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
    symbols: number;
  };
  assert.deepEqual({ status: summary.status, kind: summary.kind, output: summary.output, symbols: summary.symbols }, {
    status: "ok",
    kind: "icon_sprite_file",
    output: "generated/icons.svg",
    symbols: 2,
  });
  assert.match(summary.sha256, /^sha256:[a-f0-9]{64}$/);
  const sprite = await readFile(resolve(scratch, "generated/icons.svg"), "utf8");
  assert.equal(Buffer.byteLength(sprite), summary.bytes);
  assert.match(sprite, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="0" height="0"/);
  assert.match(sprite, /<symbol id="i-user"/);
  assert.match(sprite, /<symbol id="i-search"/);

  await writeFile(resolve(scratch, "generated/icons.svg"), "stale", "utf8");
  const replacement = spawnSync(process.execPath, [
    "--import", tsxImport, script, "batch", "user", "--format", "sprite", "--output", "generated/icons.svg",
  ], { cwd: scratch, encoding: "utf8" });
  assert.equal(replacement.status, 0, replacement.stderr);
  assert.doesNotMatch(await readFile(resolve(scratch, "generated/icons.svg"), "utf8"), /stale/);
});

test("CLI atomically inlines an opaque sprite into a single-file HTML artifact", async (context) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-cli-inline-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const target = resolve(scratch, "index.html");
  const original = "<!doctype html>\n<html><head><title>Fixture</title></head><body class=\"app\"><main>Keep me</main><script>window.fixture = true;</script></body></html>\n";
  await writeFile(target, original, "utf8");

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
  assert.equal(Buffer.byteLength(inlined), firstSummary.bytes);
  assert.match(firstSummary.sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(inlined, /<body class="app">\n  <!-- armorial:sprite:start -->/);
  assert.match(inlined, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(inlined, /<symbol id="i-user"/);
  assert.match(inlined, /<symbol id="i-search"/);
  assert.match(inlined, /<!-- armorial:sprite:end -->\n<main>Keep me<\/main>/);
  assert.match(inlined, /<script>window\.fixture = true;<\/script>/);

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
    "--allow-symbol-removal",
  );
  assert.equal(intentionalSubset.status, 0, intentionalSubset.stderr);
  const reduced = await readFile(target, "utf8");
  assert.match(reduced, /<symbol id="i-user"/);
  assert.doesNotMatch(reduced, /<symbol id="i-search"/);
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
    const result = runCliAt(scratch, "batch", "user", "--format", "sprite", ...extra);
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
  for (const output of [resolve(scratch, "absolute.svg"), "icons.html", "missing/icons.svg", "escape/icons.svg"]) {
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

  const inline = runCliAt(scratch, "batch", "user", "--inline-into", "index.html");
  assert.equal(inline.status, 0, inline.stderr);
  assert.equal(JSON.parse(inline.stdout).kind, "icon_sprite_inline");

  const help = runCliAt(scratch, "batch", "--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--inline-into relative\.html/);
  assert.doesNotMatch(help.stdout, /<svg|<symbol|<path/);
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

  for (const args of [
    ["batch", "user", "--resolve-intents"],
  ]) {
    await writeFile(target, original, "utf8");
    const result = runCliAt(scratch, ...args);
    assert.equal(result.status, 2, `${args.join(" ")}\n${result.stderr}`);
    assert.equal(result.stdout, "");
    assert.doesNotThrow(() => JSON.parse(result.stderr));
    assert.equal(await readFile(target, "utf8"), original);
  }
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
