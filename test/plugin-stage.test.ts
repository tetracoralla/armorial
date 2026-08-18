import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  assertDirectoryChainHasNoSymlink,
  assertReplaceableStageDirectory,
  captureDirectoryIdentity,
  createLocalPluginVersion,
  removeOwnedTree,
  renameOwnedDirectory,
} from "../scripts/stage-plugin.js";

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), prefix));
}

test("local plugin cachebuster preserves the public version and changes per staging time", () => {
  assert.equal(
    createLocalPluginVersion("0.1.0+codex.old", new Date("2026-08-18T03:04:05.000Z")),
    "0.1.0+codex.local-20260818-030405",
  );
});

test("plugin staging rejects a symlink in its directory chain", async () => {
  const directory = await makeTemporaryDirectory("icon-stage-chain-");
  const actual = join(directory, "actual");
  const linked = join(directory, "linked");
  try {
    await mkdir(actual);
    await symlink(actual, linked);
    assert.throws(
      () => assertDirectoryChainHasNoSymlink(linked),
      /Refusing to stage through symlink/,
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("owned cleanup unlinks nested symlinks without touching their target", async () => {
  const directory = await makeTemporaryDirectory("icon-stage-clean-");
  const outside = join(directory, "outside.txt");
  const owned = join(directory, ".owned-stage-1");
  try {
    await writeFile(outside, "keep", "utf8");
    await mkdir(join(owned, "nested"), { recursive: true });
    await symlink(outside, join(owned, "nested", "link"));
    removeOwnedTree(owned, resolve(directory), [".owned-stage-"]);
    assert.equal(await readFile(outside, "utf8"), "keep");
    assert.throws(() => removeOwnedTree(outside, resolve(directory), [".owned-stage-"]), /unexpected staging path/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("owned cleanup rejects a symlinked parent and preserves the real tree", async () => {
  const directory = await makeTemporaryDirectory("icon-stage-parent-link-");
  const actualParent = join(directory, "actual-parent");
  const linkedParent = join(directory, "linked-parent");
  const owned = join(actualParent, ".owned-stage-1");
  const sentinel = join(owned, "sentinel.txt");
  try {
    await mkdir(owned, { recursive: true });
    await writeFile(sentinel, "keep", "utf8");
    await symlink(actualParent, linkedParent);

    assert.throws(
      () => removeOwnedTree(join(linkedParent, ".owned-stage-1"), linkedParent, [".owned-stage-"]),
      /Refusing to stage through symlink/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "keep");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("owned rename rejects a symlinked parent and preserves the source", async () => {
  const directory = await makeTemporaryDirectory("icon-stage-rename-link-");
  const actualParent = join(directory, "actual-parent");
  const linkedParent = join(directory, "linked-parent");
  const source = join(actualParent, ".owned-stage-1");
  const sentinel = join(source, "sentinel.txt");
  try {
    await mkdir(source, { recursive: true });
    await writeFile(sentinel, "keep", "utf8");
    await symlink(actualParent, linkedParent);

    assert.throws(
      () => renameOwnedDirectory(
        join(linkedParent, ".owned-stage-1"),
        join(linkedParent, "icon-svg-select"),
        linkedParent,
        [".owned-stage-"],
        ["icon-svg-select"],
      ),
      /Refusing to stage through symlink/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "keep");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("owned cleanup rejects a real parent directory replaced after validation", async () => {
  const directory = await makeTemporaryDirectory("icon-stage-parent-swap-");
  const parent = join(directory, "parent");
  const retiredParent = join(directory, "retired-parent");
  const replacementOwned = join(parent, ".owned-stage-1");
  const sentinel = join(replacementOwned, "sentinel.txt");
  try {
    await mkdir(parent);
    const trustedIdentity = captureDirectoryIdentity(parent);
    await rename(parent, retiredParent);
    await mkdir(replacementOwned, { recursive: true });
    await writeFile(sentinel, "keep", "utf8");

    assert.throws(
      () => removeOwnedTree(replacementOwned, parent, [".owned-stage-"], trustedIdentity),
      /directory identity changed/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "keep");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("plugin staging refuses to replace an unowned same-name directory", async () => {
  const directory = await makeTemporaryDirectory("icon-stage-owner-");
  try {
    await writeFile(join(directory, "notes.txt"), "human data", "utf8");
    assert.throws(() => assertReplaceableStageDirectory(directory), /unowned directory/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("plugin staging accepts its exact generated-directory marker", async () => {
  const directory = await makeTemporaryDirectory("icon-stage-owner-");
  try {
    await writeFile(
      join(directory, ".icon-svg-select-generated"),
      "Generated by npm run plugin:stage; safe to replace.\n",
      "utf8",
    );
    assert.doesNotThrow(() => assertReplaceableStageDirectory(directory));
  } finally {
    await rm(directory, { recursive: true });
  }
});
