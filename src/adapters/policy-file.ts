import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_POLICY, MAX_POLICY_BYTES, type IconPolicy } from "../core/contracts.js";
import { IconKernelError } from "../core/errors.js";
import { parseIconPolicy } from "../core/policy.js";

export const POLICY_ENV_VAR = "ICON_SVG_SELECT_POLICY";
export const PROJECT_POLICY_FILENAME = "icon-policy.json";

export type PolicyResolutionContext = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

/**
 * Resolves the single server-operator policy source at startup, in order: an
 * explicit `--policy` path, the ICON_SVG_SELECT_POLICY environment variable,
 * an `icon-policy.json` in the working directory, or the default policy.
 */
export async function resolvePolicyInput(
  path: string | undefined,
  context: PolicyResolutionContext = {},
): Promise<IconPolicy> {
  const env = context.env ?? process.env;
  const cwd = context.cwd ?? process.cwd();
  if (path !== undefined) return loadPolicyFile(resolve(cwd, path));

  const envPath = env[POLICY_ENV_VAR]?.trim();
  if (envPath) return loadPolicyFile(resolve(cwd, envPath));

  const projectPolicyPath = resolve(cwd, PROJECT_POLICY_FILENAME);
  if (await isExistingFile(projectPolicyPath)) return loadPolicyFile(projectPolicyPath);

  return DEFAULT_POLICY;
}

async function isExistingFile(path: string): Promise<boolean> {
  try {
    if ((await stat(path)).isFile()) return true;
    throw new IconKernelError({
      code: "POLICY_FILE_READ_FAILED",
      message: `Policy path "${path}" is not a regular file.`,
    });
  } catch (error) {
    if (error instanceof IconKernelError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new IconKernelError({
        code: "POLICY_FILE_READ_FAILED",
        message: error instanceof Error ? error.message : `Policy file "${path}" could not be inspected.`,
      });
    }
    return false;
  }
}

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
