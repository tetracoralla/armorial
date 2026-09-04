import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const cliIndex = args.indexOf("--cli");
assert.notEqual(cliIndex, -1, "Usage: probe-publish-parent-cancellation.mjs --cli /absolute/path/to/cli.js [--deadline]");
const cli = resolve(args[cliIndex + 1] ?? "");
assert.equal(isAbsolute(cli), true);
const includeDeadline = args.includes("--deadline");
const injector = resolve(import.meta.dirname, "inject-publish-ready-pause.mjs");
const sourceMode = extname(cli) === ".ts";
const tsxImport = import.meta.resolve("tsx");
const sourceHtml = Buffer.from("<!doctype html><html><body><main>PARENT-CANCEL</main></body></html>\n", "utf8");
const originalSvg = Buffer.from("ORIGINAL-SPRITE\n", "utf8");

function nodeOptions() {
  const option = `--import=${pathToFileURL(injector).href}`;
  return process.env.NODE_OPTIONS === undefined || process.env.NODE_OPTIONS === ""
    ? option
    : `${process.env.NODE_OPTIONS} ${option}`;
}

function residue(directory) {
  return readdirSync(directory).filter((name) => name.startsWith(".armorial-publish-") && name.endsWith(".tmp"));
}

async function waitFor(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  assert.fail(message);
}

async function readReadyPid(marker, message) {
  let pid;
  await waitFor(() => {
    try {
      const value = JSON.parse(readFileSync(marker, "utf8")).pid;
      if (!Number.isSafeInteger(value) || value <= 0) return false;
      pid = value;
      return true;
    } catch {
      return false;
    }
  }, message);
  return pid;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function launch(root, marker, operation) {
  const target = operation === "candidate"
    ? "candidate.html"
    : operation === "inline"
      ? "page.html"
      : "icons.svg";
  if (operation === "candidate") writeFileSync(join(root, "source.html"), sourceHtml);
  if (operation === "inline") {
    writeFileSync(join(root, target), sourceHtml);
    chmodSync(join(root, target), 0o640);
  }
  if (operation === "svg-replace") {
    writeFileSync(join(root, target), originalSvg);
    chmodSync(join(root, target), 0o640);
  }
  const commandArgs = operation === "candidate"
    ? ["batch", "icon-park:search", "--inline-from", "source.html", "--output", target, "--format", "json"]
    : operation === "inline"
      ? ["batch", "icon-park:search", "--inline-into", target, "--allow-optimistic-overwrite", "--format", "json"]
      : operation === "svg-replace"
        ? ["batch", "icon-park:search", "--output", target, "--allow-optimistic-overwrite", "--format", "json"]
        : ["batch", "icon-park:search", "--output", target, "--format", "json"];
  const child = spawn(process.execPath, [
    ...(sourceMode ? ["--import", tsxImport] : []),
    cli,
    ...commandArgs,
  ], {
    cwd: root,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions(),
      ARMORIAL_TEST_PUBLISH_READY_MARKER: marker,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const completion = new Promise((resolveCompletion, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveCompletion({ code, signal }));
  });
  return { child, completion, stdout: () => stdout, stderr: () => stderr, target };
}

async function exerciseParentKill(operation) {
  const root = mkdtempSync(join(tmpdir(), `armorial-parent-cancel-${operation}-`));
  try {
    const marker = join(root, "publisher-ready.json");
    const run = launch(root, marker, operation);
    const helperPid = await readReadyPid(marker, `${operation} helper never reached prepared state`);
    run.child.kill("SIGKILL");
    const completion = await run.completion;
    assert.equal(completion.signal, "SIGKILL");
    await waitFor(() => !alive(helperPid), `${operation} helper outlived parent cancellation`);
    assert.equal(run.stdout(), "");
    if (operation === "candidate" || operation === "svg-create") {
      assert.equal(existsSync(join(root, run.target)), false, `${operation} must not publish after parent cancellation`);
    } else {
      assert.deepEqual(
        readFileSync(join(root, run.target)),
        operation === "inline" ? sourceHtml : originalSvg,
        `${operation} must preserve the admitted target after parent cancellation`,
      );
    }
    if (operation === "candidate") assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    assert.deepEqual(residue(root), []);
    return { operation, status: "parent-killed-before-commit+no-final-effect" };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function exerciseDeadline() {
  const root = mkdtempSync(join(tmpdir(), "armorial-publisher-deadline-"));
  try {
    const marker = join(root, "publisher-ready.json");
    const run = launch(root, marker, "candidate");
    await readReadyPid(marker, "deadline helper never reached prepared state");
    const completion = await run.completion;
    assert.equal(completion.code, 1, `stdout=${run.stdout()}\nstderr=${run.stderr()}`);
    assert.equal(run.stdout(), "");
    const failure = JSON.parse(run.stderr()).error;
    assert.equal(failure?.code, "INTERNAL_ERROR");
    assert.match(String(failure?.message), /deadline before commit authorization/);
    assert.equal(existsSync(join(root, run.target)), false);
    assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    assert.deepEqual(residue(root), []);
    return "bounded-before-commit+no-final-effect";
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function exerciseDeadlineCleanupFailure() {
  const root = mkdtempSync(join(tmpdir(), "armorial-publisher-cleanup-revocation-"));
  let permissionRevoked = false;
  try {
    const marker = join(root, "publisher-ready.json");
    const run = launch(root, marker, "candidate");
    await readReadyPid(marker, "cleanup-revocation helper never reached prepared state");
    chmodSync(root, 0o500);
    permissionRevoked = true;
    const completion = await run.completion;
    assert.equal(completion.code, 1, `stdout=${run.stdout()}\nstderr=${run.stderr()}`);
    assert.equal(run.stdout(), "");
    const failure = JSON.parse(run.stderr()).error;
    assert.equal(failure?.code, "INTERNAL_ERROR");
    assert.match(String(failure?.message), /deadline before commit authorization/);
    assert.equal(failure?.publication?.effect, "none");
    assert.equal(failure?.publication?.cleanup?.status, "failed");
    assert.match(String(failure?.publication?.cleanup?.reason), /^(?:EACCES|EPERM)$/);
    const reportedResidue = failure?.publication?.cleanup?.residue;
    assert.equal(reportedResidue?.kind, "private_temporary");
    assert.equal(reportedResidue?.location, "destination_parent");
    assert.match(String(reportedResidue?.basename), /^\.armorial-publish-[a-f0-9]{24}\.tmp$/);
    assert.equal(reportedResidue?.mode, "0600");
    assert.equal(reportedResidue?.complete, true);
    assert.equal(existsSync(join(root, run.target)), false);
    assert.deepEqual(readFileSync(join(root, "source.html")), sourceHtml);
    const temporary = residue(root);
    assert.deepEqual(temporary, [reportedResidue.basename]);
    const temporaryBytes = readFileSync(join(root, temporary[0]));
    assert.equal(temporaryBytes.byteLength, reportedResidue.bytes);
    assert.match(temporaryBytes.toString("utf8"), /<symbol id="armorial-search"/);
    return {
      status: "deadline-cause+cleanup-failure+private-complete-residue",
      effect: failure.publication.effect,
      cleanup: failure.publication.cleanup.status,
      mode: reportedResidue.mode,
    };
  } finally {
    if (permissionRevoked) chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
}

const cancellation = [];
for (const operation of ["candidate", "svg-create", "svg-replace", "inline"]) {
  cancellation.push(await exerciseParentKill(operation));
}
const deadline = includeDeadline ? await exerciseDeadline() : "not-requested";
const cleanupRevocation = includeDeadline ? await exerciseDeadlineCleanupFailure() : "not-requested";
process.stdout.write(`${JSON.stringify({ status: "ok", cli, cancellation, deadline, cleanupRevocation })}\n`);
