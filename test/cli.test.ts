import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/adapters/cli.ts", ...args], {
    cwd: workspace,
    encoding: "utf8",
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
