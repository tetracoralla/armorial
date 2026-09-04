import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { IconKernelError } from "../core/errors.js";
import { PublicationFailureStateSchema, type PublicationFailureState } from "../core/contracts.js";
import { MAX_PINNED_PUBLICATION_BYTES } from "./publication-contract.js";

export const MAX_INLINE_HTML_CALLER_BYTES = 8 * 1024 * 1024;
export const MAX_INLINE_SPRITE_BLOCK_BYTES = 512 * 1024;
const CANONICAL_INLINE_PREFIX = "\n  ";
const CANONICAL_INLINE_SUFFIX = "\n";
// Treat Armorial's own published bytes separately so a valid first insert at
// the caller limit remains a valid input for exact retries and replacements.
export const MAX_INLINE_HTML_PHYSICAL_BYTES =
  MAX_INLINE_HTML_CALLER_BYTES
  + MAX_INLINE_SPRITE_BLOCK_BYTES
  + Buffer.byteLength(CANONICAL_INLINE_PREFIX + CANONICAL_INLINE_SUFFIX);
const MAX_MARKER_INDENTATION_CODE_UNITS = 256;
const MAX_PUBLISH_HELPER_RESPONSE_BYTES = 16 * 1024;
const MAX_PUBLICATION_BASENAME_BYTES = 255;
const MAX_PUBLISH_HELPER_MILLISECONDS = 5_000;
const MAX_PUBLISH_HELPER_ABORT_GRACE_MILLISECONDS = 1_000;
const KNOWN_NO_PUBLICATION_HELPER_FAILURES = new Set([
  "PARENT_CHANGED",
  "TARGET_CHANGED",
  "HARDLINK_ALIAS",
  "DESTINATION_EXISTS",
  "PARENT_CANCELLED",
  "INVALID_COMMIT",
  "INVALID_HELPER_REQUEST",
  "INPUT_MISMATCH",
  "TEMPORARY_NAME_COLLISION",
  "TEMPORARY_CHANGED",
  "TEMPORARY_CLEANUP_FAILED",
]);

export type ResolvedIntent = Readonly<{ intent: string; id: string }>;

type TaskFileIdentity = Readonly<{
  dev: bigint;
  ino: bigint;
  mode: bigint;
  nlink: bigint;
  uid: bigint;
  gid: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}>;

type TaskFileVersion = Readonly<{
  identity: TaskFileIdentity;
  bytes: Buffer;
}>;

type PinnedParent = Readonly<{
  path: string;
  dev: bigint;
  ino: bigint;
}>;

type InlineCarrierField = "inline-from" | "inline-into";

type PreparedInlineCandidate = Readonly<{
  workingRoot: string;
  sourceParent: PinnedParent;
  source: string;
  sourceMode: number;
  sourceVersion: TaskFileVersion;
  chunks: readonly FileChunk[];
}>;

type SerializedTaskFileIdentity = Readonly<Record<keyof TaskFileIdentity, string>>;

type PinnedPublishTarget = Readonly<{ kind: "absent" }> | Readonly<{
  kind: "file";
  identity: SerializedTaskFileIdentity;
  sha256?: string;
  maximumBytes?: number;
}>;

type PinnedPublishResult = Readonly<{
  bytes: number;
  sha256: string;
  publisherMaxRssBytes: number;
  cleanupWarning?: string;
}>;

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function pathIsInside(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
}

function publicationBasename(path: string, field: "output" | InlineCarrierField): string {
  const name = basename(path);
  const bytes = Buffer.byteLength(name, "utf8");
  if (bytes < 1 || bytes > MAX_PUBLICATION_BASENAME_BYTES || name.includes("\\")) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} basename must be portable, contain no backslash, and be between 1 and ${MAX_PUBLICATION_BASENAME_BYTES} UTF-8 bytes.`,
      field,
    });
  }
  return name;
}

function taskFileIdentity(value: BigIntStats): TaskFileIdentity {
  return {
    dev: value.dev,
    ino: value.ino,
    mode: value.mode,
    nlink: value.nlink,
    uid: value.uid,
    gid: value.gid,
    size: value.size,
    mtimeNs: value.mtimeNs,
    ctimeNs: value.ctimeNs,
  };
}

function taskFileIdentityMatches(left: TaskFileIdentity, right: TaskFileIdentity): boolean {
  return Object.keys(left).every((key) => left[key as keyof TaskFileIdentity] === right[key as keyof TaskFileIdentity]);
}

function serializeTaskFileIdentity(identity: TaskFileIdentity): SerializedTaskFileIdentity {
  return Object.fromEntries(
    Object.entries(identity).map(([key, value]) => [key, value.toString(10)]),
  ) as SerializedTaskFileIdentity;
}

async function pinParent(path: string, field: "output" | InlineCarrierField): Promise<PinnedParent> {
  const identity = await lstat(path, { bigint: true });
  if (!identity.isDirectory() || identity.isSymbolicLink()) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "Publication parent changed after path resolution.",
      field,
    });
  }
  return { path, dev: identity.dev, ino: identity.ino };
}

function publicationPayload(chunks: readonly FileChunk[]): Readonly<{ bytes: Buffer; sha256: string }> {
  const buffers = chunks.map((chunk) => typeof chunk === "string"
    ? Buffer.from(chunk, "utf8")
    : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  if (total > MAX_PINNED_PUBLICATION_BYTES) {
    throw new Error(`Pinned publication must not exceed ${MAX_PINNED_PUBLICATION_BYTES} bytes.`);
  }
  const bytes = Buffer.concat(buffers, total);
  return {
    bytes,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function helperFailure(
  code: string,
  message: string,
  field: "output" | InlineCarrierField,
  publication?: PublicationFailureState,
): never {
  if (code === "PARENT_CHANGED") {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} parent directory changed after admission; no output was published through the replacement path.`,
      field,
      ...(publication === undefined ? {} : { publication }),
    });
  }
  if (code === "TARGET_CHANGED") {
    if (field === "inline-into") throw changedInlineCarrier(field, publication);
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} destination changed after admission; the external version was preserved.`,
      field,
      ...(publication === undefined ? {} : { publication }),
    });
  }
  if (code === "HARDLINK_ALIAS") {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline candidate output must not be a hard-link alias of its source HTML.",
      field: "output",
      ...(publication === undefined ? {} : { publication }),
    });
  }
  if (code === "DESTINATION_EXISTS") {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: field === "output"
        ? "output appeared while Armorial prepared it; the existing output was preserved."
        : `${field} destination appeared while Armorial prepared it; the existing output was preserved.`,
      field,
      ...(publication === undefined ? {} : { publication }),
    });
  }
  if (publication !== undefined) {
    throw new IconKernelError({
      code: "INTERNAL_ERROR",
      message: `Pinned publisher ${code}: ${message}`,
      field,
      publication,
    });
  }
  throw new Error(`Pinned publisher ${code}: ${message}`);
}

async function publishThroughPinnedParent(input: Readonly<{
  parent: PinnedParent;
  destination: string;
  operation: "create" | "replace";
  target: PinnedPublishTarget;
  sourceIdentity?: Pick<TaskFileIdentity, "dev" | "ino">;
  chunks: readonly FileChunk[];
  mode: number;
  field: "output" | InlineCarrierField;
}>): Promise<PinnedPublishResult> {
  const payload = publicationPayload(input.chunks);
  const commitToken = randomBytes(32).toString("hex");
  const request = {
    version: 1,
    operation: input.operation,
    destination: publicationBasename(input.destination, input.field),
    expectedParent: { dev: input.parent.dev.toString(10), ino: input.parent.ino.toString(10) },
    expectedTarget: input.target,
    ...(input.sourceIdentity === undefined ? {} : {
      sourceIdentity: {
        dev: input.sourceIdentity.dev.toString(10),
        ino: input.sourceIdentity.ino.toString(10),
      },
    }),
    inputBytes: payload.bytes.byteLength,
    inputSha256: payload.sha256,
    commitToken,
    mode: input.mode,
  } as const;
  const encodedRequest = Buffer.from(JSON.stringify(request), "utf8").toString("base64url");
  const sourceMode = import.meta.url.endsWith(".ts");
  const helper = fileURLToPath(new URL(sourceMode ? "./publish-helper.ts" : "./publish-helper.js", import.meta.url));
  const helperArgs = [
    ...(sourceMode ? ["--import", import.meta.resolve("tsx")] : []),
    helper,
    encodedRequest,
  ];
  const child = spawn(process.execPath, helperArgs, {
    cwd: input.parent.path,
    env: process.env,
    // The IPC channel is a liveness lease as well as the commit channel. If
    // the CLI parent disappears before it authorizes publication, Node closes
    // the channel and the helper removes its private temporary file.
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });
  const { stdin, stdout: childStdout, stderr: childStderr } = child;
  if (stdin === null || childStdout === null || childStderr === null) {
    child.kill("SIGKILL");
    throw new Error("Pinned publisher did not expose its bounded transport channels.");
  }
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let responseOverflow = false;
  let protocolFailure: Error | undefined;
  let commitAuthorized = false;
  let deadlineReached = false;
  let abortTimer: NodeJS.Timeout | undefined;

  function abortHelper(): void {
    if (child.connected) {
      child.send({
        version: 1,
        action: "abort",
        sha256: payload.sha256,
        commitToken,
      }, (error) => {
        if (error !== null && child.connected) child.disconnect();
      });
    }
    abortTimer ??= setTimeout(() => child.kill("SIGKILL"), MAX_PUBLISH_HELPER_ABORT_GRACE_MILLISECONDS);
  }

  function publicationOutcomeError(message: string): Error {
    return commitAuthorized
      ? new IconKernelError({
          code: "PUBLICATION_OUTCOME_UNCERTAIN",
          message: `${message} Publication was already authorized; inspect the destination before retrying because its final status is uncertain.`,
          field: input.field,
          publication: { effect: "unknown", cleanup: { status: "unknown" } },
        })
      : new Error(message);
  }

  child.on("message", (message: unknown) => {
    const ready = message as {
      status?: unknown;
      version?: unknown;
      bytes?: unknown;
      sha256?: unknown;
      commitToken?: unknown;
    };
    if (
      protocolFailure !== undefined
      || commitAuthorized
      || deadlineReached
      || ready.status !== "ready"
      || ready.version !== 1
      || ready.bytes !== payload.bytes.byteLength
      || ready.sha256 !== payload.sha256
      || ready.commitToken !== commitToken
    ) {
      protocolFailure ??= new Error("Pinned publisher returned an invalid readiness message.");
      abortHelper();
      return;
    }
    commitAuthorized = true;
    child.send({
      version: 1,
      action: "commit",
      sha256: payload.sha256,
      commitToken,
    }, (error) => {
      if (error !== null) {
        protocolFailure ??= new Error(`Pinned publisher commit channel failed: ${error.message}`);
        abortHelper();
      }
    });
  });
  childStdout.on("data", (chunk: Buffer) => {
    if (stdout.byteLength + chunk.byteLength > MAX_PUBLISH_HELPER_RESPONSE_BYTES) {
      responseOverflow = true;
      child.kill("SIGKILL");
      return;
    }
    stdout = Buffer.concat([stdout, chunk]);
  });
  childStderr.on("data", (chunk: Buffer) => {
    if (stderr.byteLength + chunk.byteLength > MAX_PUBLISH_HELPER_RESPONSE_BYTES) {
      responseOverflow = true;
      child.kill("SIGKILL");
      return;
    }
    stderr = Buffer.concat([stderr, chunk]);
  });
  stdin.on("error", () => undefined);
  stdin.end(payload.bytes);
  const deadline = setTimeout(() => {
    deadlineReached = true;
    abortHelper();
  }, MAX_PUBLISH_HELPER_MILLISECONDS);
  let completion: { code: number | null; signal: NodeJS.Signals | null };
  try {
    completion = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveCompletion, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveCompletion({ code, signal }));
    });
  } catch (error) {
    throw publicationOutcomeError(
      `Pinned publisher process failed: ${error instanceof Error ? error.message : "unknown process error"}.`,
    );
  } finally {
    clearTimeout(deadline);
    if (abortTimer !== undefined) clearTimeout(abortTimer);
  }
  if (responseOverflow) throw publicationOutcomeError("Pinned publisher response exceeded its bound.");
  if (completion.code === 0 && completion.signal === null) {
    let result: unknown;
    try {
      result = JSON.parse(stdout.toString("utf8"));
    } catch {
      throw publicationOutcomeError("Pinned publisher returned malformed success JSON.");
    }
    const value = result as Partial<PinnedPublishResult> & { status?: unknown };
    if (
      value.status !== "ok"
      || value.bytes !== payload.bytes.byteLength
      || value.sha256 !== payload.sha256
      || typeof value.publisherMaxRssBytes !== "number"
      || !Number.isSafeInteger(value.publisherMaxRssBytes)
      || value.publisherMaxRssBytes <= 0
      || (value.cleanupWarning !== undefined && typeof value.cleanupWarning !== "string")
    ) throw publicationOutcomeError("Pinned publisher returned an invalid success result.");
    return {
      bytes: value.bytes,
      sha256: value.sha256,
      publisherMaxRssBytes: value.publisherMaxRssBytes,
      ...(value.cleanupWarning === undefined ? {} : { cleanupWarning: value.cleanupWarning }),
    };
  }
  if (protocolFailure !== undefined) throw publicationOutcomeError(protocolFailure.message);
  let failure: { code?: unknown; message?: unknown; publication?: unknown } = {};
  try {
    failure = JSON.parse(stderr.toString("utf8")) as { code?: unknown; message?: unknown; publication?: unknown };
  } catch {
    // The bounded raw exit details below remain useful for a helper crash.
  }
  const publication = PublicationFailureStateSchema.safeParse(failure.publication);
  if (deadlineReached) {
    const message = commitAuthorized
      ? "Pinned publisher exceeded its deadline after commit authorization."
      : "Pinned publisher exceeded its deadline before commit authorization; no final publication was authorized.";
    if (!commitAuthorized && publication.success) {
      throw new IconKernelError({
        code: "INTERNAL_ERROR",
        message,
        field: input.field,
        publication: publication.data,
      });
    }
    throw publicationOutcomeError(message);
  }
  if (typeof failure.code === "string" && typeof failure.message === "string") {
    // Once the parent has dispatched the commit token, only helper failures
    // whose implementation contract rules out a final-path mutation may keep
    // their precise closed-failure meaning. An unknown or generic helper error
    // can have occurred after publication (for example while emitting the
    // success response), so collapsing it to INTERNAL_ERROR would make a blind
    // retry look safe when the destination may already contain the result.
    if (commitAuthorized && !KNOWN_NO_PUBLICATION_HELPER_FAILURES.has(failure.code)) {
      throw publicationOutcomeError(`Pinned publisher ${failure.code}: ${failure.message}`);
    }
    helperFailure(failure.code, failure.message, input.field, publication.success ? publication.data : undefined);
  }
  throw publicationOutcomeError(`Pinned publisher exited unexpectedly (${completion.signal ?? completion.code ?? "unknown"}).`);
}

function changedInlineCarrier(
  field: InlineCarrierField,
  publication?: PublicationFailureState,
): IconKernelError {
  return new IconKernelError({
    code: "INVALID_INPUT",
    message: field === "inline-into"
      ? "inline-into HTML changed after Armorial read it; the external version was preserved. Retry with a stable task file."
      : "inline-from HTML changed while Armorial read it; no candidate was published. Retry from the current source.",
    field,
    ...(publication === undefined ? {} : { publication }),
  });
}

function isConcurrentFileChange(error: unknown): boolean {
  return ["EACCES", "EISDIR", "ELOOP", "ENOENT", "ENOTDIR", "EPERM"].includes(
    (error as NodeJS.ErrnoException).code ?? "",
  );
}

async function readBoundedFile(handle: FileHandle, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (bytes <= maximumBytes) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - bytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    bytes += bytesRead;
  }
  return Buffer.concat(chunks, bytes);
}

async function readStableTaskFile(
  destination: string,
  admittedIdentity: TaskFileIdentity,
  maximumBytes: number,
  field: InlineCarrierField,
): Promise<TaskFileVersion> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(destination, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = taskFileIdentity(await handle.stat({ bigint: true }));
    if (!taskFileIdentityMatches(admittedIdentity, before)) throw changedInlineCarrier(field);
    const bytes = await readBoundedFile(handle, maximumBytes);
    const after = taskFileIdentity(await handle.stat({ bigint: true }));
    const pathAfter = taskFileIdentity(await lstat(destination, { bigint: true }));
    if (
      bytes.byteLength > maximumBytes
      || BigInt(bytes.byteLength) !== after.size
      || !taskFileIdentityMatches(before, after)
      || !taskFileIdentityMatches(after, pathAfter)
    ) throw changedInlineCarrier(field);
    return { identity: after, bytes };
  } catch (error) {
    if (error instanceof IconKernelError) throw error;
    if (isConcurrentFileChange(error)) throw changedInlineCarrier(field);
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function writeSpriteFile(
  outputPath: string,
  sprite: string,
  symbolCount: number,
  resolved?: readonly ResolvedIntent[],
  allowOptimisticOverwrite = false,
): Promise<void> {
  if (isAbsolute(outputPath) || !outputPath.toLowerCase().endsWith(".svg")) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output must be a relative .svg path inside the current working directory.",
      field: "output",
    });
  }
  const destinationName = publicationBasename(outputPath, "output");

  const logicalDestination = resolve(process.cwd(), outputPath);
  let workingRoot: string;
  let parentRoot: string;
  try {
    [workingRoot, parentRoot] = await Promise.all([
      realpath(process.cwd()),
      realpath(dirname(logicalDestination)),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "output parent directory must already exist.",
        field: "output",
      });
    }
    throw error;
  }
  if (!pathIsInside(workingRoot, parentRoot)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output must remain inside the current working directory and cannot traverse a symlink outside it.",
      field: "output",
    });
  }
  const pinnedParent = await pinParent(parentRoot, "output");

  const destination = join(parentRoot, destinationName);
  // Match ordinary file-creation semantics: the caller's umask may narrow the
  // default mode, but publication must never broaden it again in the helper.
  let mode = 0o644 & ~process.umask();
  let expectedTarget: PinnedPublishTarget = { kind: "absent" };
  try {
    const current = await lstat(destination, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "output may replace only a regular file.",
        field: "output",
      });
    }
    mode = Number(current.mode & 0o777n);
    expectedTarget = { kind: "file", identity: serializeTaskFileIdentity(taskFileIdentity(current)) };
    if (!allowOptimisticOverwrite) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "output already exists. Use a new path, or explicitly pass --allow-optimistic-overwrite to accept the final check-to-rename window.",
        field: "output",
      });
    }
  } catch (error) {
    if (error instanceof IconKernelError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (allowOptimisticOverwrite) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "allow-optimistic-overwrite is valid only when output already exists as a regular SVG file.",
        field: "allow-optimistic-overwrite",
      });
    }
  }

  const serialized = `${sprite}\n`;
  const replacing = expectedTarget.kind === "file";
  const publication = await publishThroughPinnedParent({
    parent: pinnedParent,
    destination,
    operation: expectedTarget.kind === "absent" ? "create" : "replace",
    target: expectedTarget,
    chunks: [serialized],
    mode,
    field: "output",
  });

  writeJson({
    status: "ok",
    kind: "icon_sprite_file",
    output: relative(workingRoot, destination) || basename(destination),
    bytes: publication.bytes,
    sha256: publication.sha256,
    protectionLevel: replacing ? "optimistic_preflight_only" : "non_overwriting_create",
    ...(replacing ? {
      concurrencyWarning: "A non-cooperating writer can still change this file after Armorial's final check and before atomic rename.",
    } : {}),
    ...(publication.cleanupWarning === undefined ? {} : { cleanupWarning: publication.cleanupWarning }),
    symbols: symbolCount,
    ...(resolved === undefined ? {} : { resolved }),
  });
}

async function resolveExistingTaskFile(inputPath: string, extension: RegExp, field: InlineCarrierField): Promise<{
  workingRoot: string;
  parent: PinnedParent;
  destination: string;
  mode: number;
  identity: TaskFileIdentity;
}> {
  if (isAbsolute(inputPath) || !extension.test(inputPath)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} must be a relative ${field.startsWith("inline-") ? ".html or .htm" : ".svg"} path inside the current working directory.`,
      field,
    });
  }
  const destinationName = publicationBasename(inputPath, field);

  const logicalDestination = resolve(process.cwd(), inputPath);
  let workingRoot: string;
  let parentRoot: string;
  try {
    [workingRoot, parentRoot] = await Promise.all([
      realpath(process.cwd()),
      realpath(dirname(logicalDestination)),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `${field} parent directory must already exist.`,
        field,
      });
    }
    throw error;
  }
  if (!pathIsInside(workingRoot, parentRoot)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} must remain inside the current working directory and cannot traverse a symlink outside it.`,
      field,
    });
  }
  const parent = await pinParent(parentRoot, field);

  const destination = join(parentRoot, destinationName);
  let current;
  try {
    current = await lstat(destination, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `${field} must name an existing regular file.`,
        field,
      });
    }
    throw error;
  }
  if (!current.isFile() || current.isSymbolicLink()) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} must name an existing regular file.`,
      field,
    });
  }
  return {
    workingRoot,
    parent,
    destination,
    mode: Number(current.mode & 0o777n),
    identity: taskFileIdentity(current),
  };
}

type FileChunk = string | Uint8Array;

async function resolveNewInlineCandidate(
  outputPath: string,
  source: string,
  sourceIdentity: TaskFileIdentity,
): Promise<{ workingRoot: string; parent: PinnedParent; destination: string }> {
  if (isAbsolute(outputPath) || !/\.html?$/i.test(outputPath)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output must be a relative .html or .htm path for an inline candidate.",
      field: "output",
    });
  }
  const destinationName = publicationBasename(outputPath, "output");
  const logicalDestination = resolve(process.cwd(), outputPath);
  let workingRoot: string;
  let parentRoot: string;
  try {
    [workingRoot, parentRoot] = await Promise.all([
      realpath(process.cwd()),
      realpath(dirname(logicalDestination)),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "output parent directory must already exist.",
        field: "output",
      });
    }
    throw error;
  }
  if (!pathIsInside(workingRoot, parentRoot)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output must remain inside the current working directory and cannot traverse a symlink outside it.",
      field: "output",
    });
  }
  const parent = await pinParent(parentRoot, "output");
  const destination = join(parentRoot, destinationName);
  if (destination === source) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline candidate output must be different from its source HTML.",
      field: "output",
    });
  }
  try {
    const existing = taskFileIdentity(await lstat(destination, { bigint: true }));
    if (existing.dev === sourceIdentity.dev && existing.ino === sourceIdentity.ino) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "inline candidate output must not be a hard-link alias of its source HTML.",
        field: "output",
      });
    }
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline candidate output must not already exist.",
      field: "output",
    });
  } catch (error) {
    if (error instanceof IconKernelError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { workingRoot, parent, destination };
}

function byteOffsetAt(original: string, codeUnitOffset: number, leadingByteOffset: number): number {
  return leadingByteOffset + Buffer.byteLength(original.slice(0, codeUnitOffset), "utf8");
}

function boundedManagedBlock(block: string, indentation: string, field: InlineCarrierField): string {
  const published = block.replaceAll("\n", `\n${indentation}`);
  if (Buffer.byteLength(published, "utf8") > MAX_INLINE_SPRITE_BLOCK_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} Armorial sprite block must not exceed ${MAX_INLINE_SPRITE_BLOCK_BYTES} bytes.`,
      field,
    });
  }
  return published;
}

async function prepareInlineSpriteCandidate(
  inputPath: string,
  sprite: string,
  allowSymbolRemoval = false,
  field: InlineCarrierField = "inline-into",
): Promise<PreparedInlineCandidate> {
  const { workingRoot, parent, destination, mode, identity } = await resolveExistingTaskFile(inputPath, /\.html?$/i, field);
  if (identity.size > BigInt(MAX_INLINE_HTML_PHYSICAL_BYTES)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} physical HTML must not exceed ${MAX_INLINE_HTML_PHYSICAL_BYTES} bytes.`,
      field,
    });
  }
  const originalVersion = await readStableTaskFile(
    destination,
    identity,
    MAX_INLINE_HTML_PHYSICAL_BYTES,
    field,
  );
  const originalBytes = originalVersion.bytes;
  const {
    parseHtmlCarrierStructure,
    SPRITE_END_MARKER,
    SPRITE_START_MARKER,
  } = await import("./html-carrier.js");
  if (
    originalBytes.byteLength > MAX_INLINE_HTML_CALLER_BYTES
    && (
      !originalBytes.includes(Buffer.from(SPRITE_START_MARKER, "utf8"))
      || !originalBytes.includes(Buffer.from(SPRITE_END_MARKER, "utf8"))
    )
  ) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} caller-owned HTML must not exceed ${MAX_INLINE_HTML_CALLER_BYTES} bytes.`,
      field,
    });
  }
  let original: string;
  const leadingByteOffset = originalBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
  try {
    // TextDecoder removes a leading UTF-8 BOM. Keep its byte width separately
    // so parse5 sees ordinary HTML while raw-byte splice offsets remain exact.
    original = new TextDecoder("utf-8", { fatal: true }).decode(originalBytes);
  } catch {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} HTML must be valid UTF-8 so existing bytes can be preserved.`,
      field,
    });
  }
  const structure = await parseHtmlCarrierStructure(original, field);

  const block = `${SPRITE_START_MARKER}\n${sprite}\n${SPRITE_END_MARKER}`;
  let chunks: readonly FileChunk[];
  let callerOwnedBytes: number;
  if (structure.startMarker !== undefined && structure.endMarker !== undefined) {
    const start = structure.startMarker.startOffset;
    const end = structure.endMarker.endOffset;
    const startByte = byteOffsetAt(original, start, leadingByteOffset);
    const endByte = startByte + Buffer.byteLength(original.slice(start, end), "utf8");
    const existingBlockBytes = endByte - startByte;
    if (existingBlockBytes > MAX_INLINE_SPRITE_BLOCK_BYTES) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `${field} existing Armorial sprite block must not exceed ${MAX_INLINE_SPRITE_BLOCK_BYTES} bytes.`,
        field,
      });
    }
    const previousBlock = original.slice(start, end);
    const previousSymbols = [...previousBlock.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]!);
    const nextSymbols = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]!));
    const removedSymbols = previousSymbols.filter((id) => !nextSymbols.has(id));
    if (removedSymbols.length > 0 && !allowSymbolRemoval) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `${field} would remove ${removedSymbols.length} existing Armorial symbols (${removedSymbols.slice(0, 8).join(", ")}${removedSymbols.length > 8 ? ", …" : ""}); rerun with the complete union or pass --allow-symbol-removal after confirming they are unused.`,
        field,
      });
    }
    const lineStart = original.lastIndexOf("\n", start - 1) + 1;
    if (start - lineStart > MAX_MARKER_INDENTATION_CODE_UNITS) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `${field} Armorial sprite marker indentation must not exceed ${MAX_MARKER_INDENTATION_CODE_UNITS} UTF-16 code units.`,
        field,
      });
    }
    const indentation = original.slice(lineStart, start);
    if (!/^\s*$/.test(indentation)) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `${field} Armorial sprite marker must start on its own line.`,
        field,
      });
    }
    const bodyContentStartByte = byteOffsetAt(original, structure.bodyContentStart, leadingByteOffset);
    const canonicalPrefix = Buffer.from(CANONICAL_INLINE_PREFIX, "utf8");
    const canonicalSuffix = Buffer.from(CANONICAL_INLINE_SUFFIX, "utf8");
    const hasCanonicalArmorialFraming =
      startByte === bodyContentStartByte + canonicalPrefix.byteLength
      && originalBytes.subarray(bodyContentStartByte, startByte).equals(canonicalPrefix)
      && originalBytes.subarray(endByte, endByte + canonicalSuffix.byteLength).equals(canonicalSuffix);
    const framingBytes = hasCanonicalArmorialFraming
      ? canonicalPrefix.byteLength + canonicalSuffix.byteLength
      : 0;
    callerOwnedBytes = originalBytes.byteLength - existingBlockBytes - framingBytes;
    chunks = [
      originalBytes.subarray(0, startByte),
      boundedManagedBlock(block, indentation, field),
      originalBytes.subarray(endByte),
    ];
  } else {
    callerOwnedBytes = originalBytes.byteLength;
    const insertion = structure.bodyContentStart;
    const insertionByte = byteOffsetAt(original, insertion, leadingByteOffset);
    chunks = [
      originalBytes.subarray(0, insertionByte),
      `${CANONICAL_INLINE_PREFIX}${boundedManagedBlock(block, "  ", field)}${CANONICAL_INLINE_SUFFIX}`,
      originalBytes.subarray(insertionByte),
    ];
  }

  if (callerOwnedBytes > MAX_INLINE_HTML_CALLER_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} caller-owned HTML must not exceed ${MAX_INLINE_HTML_CALLER_BYTES} bytes.`,
      field,
    });
  }
  const prospectiveBytes = chunks.reduce(
    (total, chunk) => total + (typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength),
    0,
  );
  if (prospectiveBytes > MAX_INLINE_HTML_PHYSICAL_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} published HTML must not exceed ${MAX_INLINE_HTML_PHYSICAL_BYTES} bytes.`,
      field,
    });
  }

  return {
    workingRoot,
    sourceParent: parent,
    source: destination,
    sourceMode: mode,
    sourceVersion: originalVersion,
    chunks,
  };
}

export async function writeInlineSpriteCandidate(
  inputPath: string,
  outputPath: string,
  sprite: string,
  symbolCount: number,
  resolved?: readonly ResolvedIntent[],
  allowSymbolRemoval = false,
): Promise<PinnedPublishResult> {
  // Close the obvious alias before either path can be concurrently rebound.
  // Physical same-file and hard-link checks still run after realpath/lstat.
  if (resolve(process.cwd(), inputPath) === resolve(process.cwd(), outputPath)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline candidate output must be different from its source HTML.",
      field: "output",
    });
  }
  const prepared = await prepareInlineSpriteCandidate(inputPath, sprite, allowSymbolRemoval, "inline-from");
  const { parent, destination } = await resolveNewInlineCandidate(
    outputPath,
    prepared.source,
    prepared.sourceVersion.identity,
  );
  const publication = await publishThroughPinnedParent({
    parent,
    destination,
    operation: "create",
    target: { kind: "absent" },
    sourceIdentity: prepared.sourceVersion.identity,
    chunks: prepared.chunks,
    mode: prepared.sourceMode,
    field: "output",
  });
  writeJson({
    status: "ok",
    kind: "icon_sprite_inline_candidate",
    source: relative(prepared.workingRoot, prepared.source) || basename(prepared.source),
    output: relative(prepared.workingRoot, destination) || basename(destination),
    sourceSha256: `sha256:${createHash("sha256").update(prepared.sourceVersion.bytes).digest("hex")}`,
    candidateSha256: publication.sha256,
    protectionLevel: "non_overwriting_candidate",
    bytes: publication.bytes,
    ...(publication.cleanupWarning === undefined ? {} : { cleanupWarning: publication.cleanupWarning }),
    symbols: symbolCount,
    ...(resolved === undefined ? {} : { resolved }),
  });
  return publication;
}

export async function inlineSpriteIntoHtml(
  inputPath: string,
  sprite: string,
  symbolCount: number,
  resolved?: readonly ResolvedIntent[],
  allowSymbolRemoval = false,
): Promise<void> {
  const prepared = await prepareInlineSpriteCandidate(inputPath, sprite, allowSymbolRemoval, "inline-into");
  const sourceSha256 = `sha256:${createHash("sha256").update(prepared.sourceVersion.bytes).digest("hex")}`;
  const publication = await publishThroughPinnedParent({
    parent: prepared.sourceParent,
    destination: prepared.source,
    operation: "replace",
    target: {
      kind: "file",
      identity: serializeTaskFileIdentity(prepared.sourceVersion.identity),
      sha256: sourceSha256,
      maximumBytes: MAX_INLINE_HTML_PHYSICAL_BYTES,
    },
    chunks: prepared.chunks,
    mode: prepared.sourceMode,
    field: "inline-into",
  });
  writeJson({
    status: "ok",
    kind: "icon_sprite_inline",
    output: relative(prepared.workingRoot, prepared.source) || basename(prepared.source),
    sourceSha256,
    candidateSha256: publication.sha256,
    protectionLevel: "optimistic_preflight_only",
    concurrencyWarning: "A non-cooperating writer can still change this file after Armorial's final check and before atomic rename.",
    bytes: publication.bytes,
    sha256: publication.sha256,
    ...(publication.cleanupWarning === undefined ? {} : { cleanupWarning: publication.cleanupWarning }),
    symbols: symbolCount,
    ...(resolved === undefined ? {} : { resolved }),
  });
}
