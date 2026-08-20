import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  POLICY_ENV_VAR,
  PROJECT_POLICY_FILENAME,
  loadPolicyFile,
  resolvePolicyInput,
} from "../src/adapters/policy-file.js";
import { DEFAULT_POLICY, MAX_POLICY_BYTES } from "../src/core/contracts.js";
import { IconKernelError } from "../src/core/errors.js";

function projectPolicy(selection: string) {
  return JSON.stringify({
    ...structuredClone(DEFAULT_POLICY),
    selections: { [selection]: "icon-park:setting-two" },
  });
}

async function withProjectDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "icon-svg-select-policy-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true });
  }
}

test("policy loader rejects an oversized file before JSON parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "icon-svg-select-policy-"));
  const path = join(directory, "oversized.json");
  try {
    await writeFile(path, "x".repeat(MAX_POLICY_BYTES + 1), "utf8");
    await assert.rejects(
      loadPolicyFile(path),
      (error: unknown) => error instanceof IconKernelError && error.error.code === "POLICY_FILE_TOO_LARGE",
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("policy resolution prefers the explicit path over env and project files", async () => {
  await withProjectDirectory(async (directory) => {
    const explicit = join(directory, "explicit.json");
    const fromEnv = join(directory, "from-env.json");
    await writeFile(explicit, projectPolicy("explicit"), "utf8");
    await writeFile(fromEnv, projectPolicy("from-env"), "utf8");
    await writeFile(join(directory, PROJECT_POLICY_FILENAME), projectPolicy("project"), "utf8");
    const policy = await resolvePolicyInput(explicit, {
      env: { [POLICY_ENV_VAR]: fromEnv },
      cwd: directory,
    });
    assert.deepEqual(Object.keys(policy.selections), ["explicit"]);
  });
});

test("policy resolution reads ICON_SVG_SELECT_POLICY when no path is given", async () => {
  await withProjectDirectory(async (directory) => {
    const fromEnv = join(directory, "from-env.json");
    await writeFile(fromEnv, projectPolicy("from-env"), "utf8");
    await writeFile(join(directory, PROJECT_POLICY_FILENAME), projectPolicy("project"), "utf8");
    const policy = await resolvePolicyInput(undefined, {
      env: { [POLICY_ENV_VAR]: fromEnv },
      cwd: directory,
    });
    assert.deepEqual(Object.keys(policy.selections), ["from-env"]);
  });
});

test("policy resolution discovers icon-policy.json in the working directory", async () => {
  await withProjectDirectory(async (directory) => {
    await writeFile(join(directory, PROJECT_POLICY_FILENAME), projectPolicy("project"), "utf8");
    const policy = await resolvePolicyInput(undefined, { env: {}, cwd: directory });
    assert.deepEqual(Object.keys(policy.selections), ["project"]);
  });
});

test("policy resolution falls back to the default policy when nothing is configured", async () => {
  await withProjectDirectory(async (directory) => {
    const policy = await resolvePolicyInput(undefined, { env: {}, cwd: directory });
    assert.deepEqual(policy, DEFAULT_POLICY);
  });
});

test("a broken discovered project policy fails startup instead of being ignored", async () => {
  await withProjectDirectory(async (directory) => {
    await writeFile(join(directory, PROJECT_POLICY_FILENAME), "{\"version\": 1}", "utf8");
    await assert.rejects(
      resolvePolicyInput(undefined, { env: {}, cwd: directory }),
      (error: unknown) => error instanceof IconKernelError && error.error.code === "INVALID_POLICY",
    );
  });
});

test("a version 1 policy fails with an explicit stroke-scale migration message", async () => {
  await withProjectDirectory(async (directory) => {
    const legacy = { ...structuredClone(DEFAULT_POLICY), version: 1 };
    await writeFile(join(directory, PROJECT_POLICY_FILENAME), JSON.stringify(legacy), "utf8");
    await assert.rejects(
      resolvePolicyInput(undefined, { env: {}, cwd: directory }),
      (error: unknown) => error instanceof IconKernelError
        && error.error.code === "INVALID_POLICY"
        && /Migrate to version 2/.test(error.error.message),
    );
  });
});

test("a non-file discovered project policy fails startup instead of using defaults", async () => {
  await withProjectDirectory(async (directory) => {
    await mkdir(join(directory, PROJECT_POLICY_FILENAME));
    await assert.rejects(
      resolvePolicyInput(undefined, { env: {}, cwd: directory }),
      (error: unknown) => error instanceof IconKernelError && error.error.code === "POLICY_FILE_READ_FAILED",
    );
  });
});

test("policy loader rejects reserved record keys instead of dropping them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "icon-svg-select-policy-"));
  const path = join(directory, "reserved-key.json");
  const policyJson = JSON.stringify({
    version: 2,
    collections: ["icon-park"],
    defaults: {
      theme: "outline",
      size: 24,
      strokeWidth: 4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      colors: { primary: "currentColor", secondary: "#2F88FF", innerStroke: "#FFFFFF", innerFill: "#43CCF8" },
    },
    contexts: {},
    selections: { settings: "icon-park:setting-two" },
  });
  // Written as raw text so JSON.parse keeps "__proto__" as an own key.
  const withReservedKey = policyJson.replace('"settings"', '"__proto__":"icon-park:hi","settings"');
  try {
    await writeFile(path, withReservedKey, "utf8");
    await assert.rejects(
      loadPolicyFile(path),
      (error: unknown) => error instanceof IconKernelError && error.error.code === "INVALID_POLICY",
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});
