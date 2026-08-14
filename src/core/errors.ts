import type { KernelError } from "./contracts.js";

export class IconKernelError extends Error {
  readonly error: KernelError;

  constructor(error: KernelError) {
    super(error.message);
    this.name = "IconKernelError";
    this.error = error;
  }
}

export function toKernelError(error: unknown): KernelError {
  if (error instanceof IconKernelError) {
    return error.error;
  }

  return {
    code: "ICON_RENDER_FAILED",
    message: error instanceof Error ? error.message : "The icon operation failed.",
  };
}
