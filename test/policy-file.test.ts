import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPolicyFile } from "../src/adapters/policy-file.js";
import { MAX_POLICY_BYTES } from "../src/core/contracts.js";
import { IconKernelError } from "../src/core/errors.js";

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
