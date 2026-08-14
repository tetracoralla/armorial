import { readFile, stat } from "node:fs/promises";
import { MAX_POLICY_BYTES, type IconPolicy } from "../core/contracts.js";
import { IconKernelError } from "../core/errors.js";
import { parseIconPolicy } from "../core/policy.js";

export async function loadPolicyFile(path: string): Promise<IconPolicy> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    throw new IconKernelError({
      code: "POLICY_FILE_READ_FAILED",
      message: error instanceof Error ? error.message : `Policy file "${path}" could not be inspected.`,
    });
  }

  if (size > MAX_POLICY_BYTES) {
    throw new IconKernelError({
      code: "POLICY_FILE_TOO_LARGE",
      message: `Policy file exceeds the ${MAX_POLICY_BYTES}-byte limit.`,
    });
  }

  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new IconKernelError({
      code: "POLICY_FILE_READ_FAILED",
      message: error instanceof Error ? error.message : `Policy file "${path}" could not be read.`,
    });
  }

  if (Buffer.byteLength(source, "utf8") > MAX_POLICY_BYTES) {
    throw new IconKernelError({
      code: "POLICY_FILE_TOO_LARGE",
      message: `Policy file exceeds the ${MAX_POLICY_BYTES}-byte limit.`,
    });
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new IconKernelError({
      code: "INVALID_POLICY",
      message: error instanceof Error ? error.message : "Policy file is not valid JSON.",
    });
  }
  return parseIconPolicy(value);
}
