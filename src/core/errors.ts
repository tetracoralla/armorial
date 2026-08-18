import type { z } from "zod";
import type { KernelError } from "./contracts.js";

export class IconKernelError extends Error {
  readonly error: KernelError;

  constructor(error: KernelError) {
    super(error.message);
    this.name = "IconKernelError";
    this.error = error;
  }
}

export function zodIssuesToKernelError(
  code: KernelError["code"],
  error: z.ZodError,
  fallbackMessage: string,
): KernelError {
  const issue = error.issues[0];
  return {
    code,
    message: issue?.message ?? fallbackMessage,
    ...(issue?.path.length ? { field: issue.path.join(".") } : {}),
  };
}

export function toKernelError(error: unknown): KernelError {
  if (error instanceof IconKernelError) {
    return error.error;
  }

  // Unexpected failures are reported as internal instead of borrowing a
  // domain code such as ICON_RENDER_FAILED, which would misreport a bug as a
  // domain-level condition.
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "The icon operation failed unexpectedly.",
  };
}
