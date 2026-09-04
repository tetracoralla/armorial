import { createHash, randomBytes } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { chmod, link, lstat, open, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { MAX_PINNED_PUBLICATION_BYTES } from "./publication-contract.js";

const MAX_REQUEST_ARGUMENT_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024;
// The CLI owns the shorter publication deadline. This longer helper bound is
// only a final cleanup backstop if its parent remains connected but never
// commits or aborts.
const MAX_PARENT_COMMIT_WAIT_MS = 7_000;

type SerializedIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
  nlink: string;
  uid: string;
  gid: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}>;

type PublishRequest = Readonly<{
  version: 1;
  operation: "create" | "replace";
  destination: string;
  expectedParent: Readonly<{ dev: string; ino: string }>;
  expectedTarget: Readonly<{ kind: "absent" }> | Readonly<{
    kind: "file";
    identity: SerializedIdentity;
    sha256?: string;
    maximumBytes?: number;
  }>;
  sourceIdentity?: Readonly<{ dev: string; ino: string }>;
  inputBytes: number;
  inputSha256: string;
  commitToken: string;
  mode: number;
}>;

type PublicationFailureState = Readonly<{
  effect: "none" | "unknown";
  cleanup: Readonly<{
    status: "not_needed" | "complete" | "failed" | "unknown";
    reason?: string;
    residue?: Readonly<{
      kind: "private_temporary";
      location: "destination_parent";
      basename: string;
      mode: string;
      bytes: number;
      complete: boolean;
    }>;
  }>;
}>;

class PublishFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly publication?: PublicationFailureState,
  ) {
    super(message);
    this.name = "PublishFailure";
  }
}

function failureMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Pinned publisher failed unexpectedly.").slice(0, 512);
}

function failureReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : "UNKNOWN";
}

function modeString(mode: bigint): string {
  return (mode & 0o777n).toString(8).padStart(4, "0");
}

function sameTemporaryVersion(expected: BigIntStats | undefined, actual: BigIntStats): boolean {
  return expected !== undefined
    && expected.dev === actual.dev
    && expected.ino === actual.ino
    && expected.mode === actual.mode
    && expected.size === actual.size
    && expected.mtimeNs === actual.mtimeNs
    && expected.ctimeNs === actual.ctimeNs;
}

async function failedCleanupState(
  error: unknown,
  temporary: string,
  expected: BigIntStats | undefined,
  expectedBytes: number,
): Promise<PublicationFailureState["cleanup"]> {
  let residue: PublicationFailureState["cleanup"]["residue"];
  try {
    const actual = await lstat(temporary, { bigint: true });
    if (actual.isFile() && !actual.isSymbolicLink()) {
      residue = {
        kind: "private_temporary",
        location: "destination_parent",
        basename: temporary,
        mode: modeString(actual.mode),
        bytes: Number(actual.size),
        complete: actual.size === BigInt(expectedBytes) && sameTemporaryVersion(expected, actual),
      };
    }
  } catch {
    // The unlink failed, but a concurrent actor may already have removed or
    // replaced the private name. Report the cleanup failure without inventing
    // a residue that the helper could not reacquire.
  }
  return {
    status: "failed",
    reason: failureReason(error),
    ...(residue === undefined ? {} : { residue }),
  };
}

function boundedJson(value: unknown): string {
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES) return '{"status":"error","code":"HELPER_RESPONSE_TOO_LARGE","message":"Pinned publisher response exceeded its bound."}\n';
  return serialized;
}

function decimal(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new PublishFailure("INVALID_HELPER_REQUEST", `${field} must be an unsigned decimal integer.`);
  }
  return BigInt(value);
}

function parseRequest(argument: string | undefined): PublishRequest {
  if (argument === undefined || Buffer.byteLength(argument) > MAX_REQUEST_ARGUMENT_BYTES) {
    throw new PublishFailure("INVALID_HELPER_REQUEST", "Pinned publisher request is missing or too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(argument, "base64url").toString("utf8"));
  } catch {
    throw new PublishFailure("INVALID_HELPER_REQUEST", "Pinned publisher request is not valid encoded JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublishFailure("INVALID_HELPER_REQUEST", "Pinned publisher request must be an object.");
  }
  const request = value as Partial<PublishRequest>;
  if (
    request.version !== 1
    || !["create", "replace"].includes(String(request.operation))
    || typeof request.destination !== "string"
    || Buffer.byteLength(request.destination, "utf8") < 1
    || Buffer.byteLength(request.destination, "utf8") > 255
    || request.destination.includes("/")
    || request.destination.includes("\\")
    || request.destination.includes("\0")
    || request.destination === "."
    || request.destination === ".."
    || typeof request.expectedParent !== "object"
    || request.expectedParent === null
    || typeof request.expectedTarget !== "object"
    || request.expectedTarget === null
    || !Number.isSafeInteger(request.inputBytes)
    || Number(request.inputBytes) < 0
    || Number(request.inputBytes) > MAX_PINNED_PUBLICATION_BYTES
    || typeof request.inputSha256 !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(request.inputSha256)
    || typeof request.commitToken !== "string"
    || !/^[a-f0-9]{64}$/.test(request.commitToken)
    || !Number.isInteger(request.mode)
    || Number(request.mode) < 0
    || Number(request.mode) > 0o777
  ) {
    throw new PublishFailure("INVALID_HELPER_REQUEST", "Pinned publisher request has invalid fields.");
  }
  decimal(request.expectedParent.dev, "expectedParent.dev");
  decimal(request.expectedParent.ino, "expectedParent.ino");
  if (!['absent', 'file'].includes(String(request.expectedTarget.kind))) {
    throw new PublishFailure("INVALID_HELPER_REQUEST", "Pinned publisher target expectation is invalid.");
  }
  if (request.expectedTarget.kind === "file") {
    const identity = request.expectedTarget.identity;
    if (typeof identity !== "object" || identity === null) {
      throw new PublishFailure("INVALID_HELPER_REQUEST", "Pinned publisher file identity is missing.");
    }
    for (const field of ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"] as const) {
      decimal(identity[field], `expectedTarget.identity.${field}`);
    }
    if (
      request.expectedTarget.sha256 !== undefined
      && !/^sha256:[a-f0-9]{64}$/.test(request.expectedTarget.sha256)
    ) throw new PublishFailure("INVALID_HELPER_REQUEST", "Pinned publisher target hash is invalid.");
    if (
      request.expectedTarget.maximumBytes !== undefined
      && (!Number.isSafeInteger(request.expectedTarget.maximumBytes) || request.expectedTarget.maximumBytes < 0)
    ) throw new PublishFailure("INVALID_HELPER_REQUEST", "Pinned publisher target byte bound is invalid.");
  }
  if (request.sourceIdentity !== undefined) {
    decimal(request.sourceIdentity.dev, "sourceIdentity.dev");
    decimal(request.sourceIdentity.ino, "sourceIdentity.ino");
  }
  return request as PublishRequest;
}

function identityMatches(expected: SerializedIdentity, actual: BigIntStats): boolean {
  return (
    actual.dev === BigInt(expected.dev)
    && actual.ino === BigInt(expected.ino)
    && actual.mode === BigInt(expected.mode)
    && actual.nlink === BigInt(expected.nlink)
    && actual.uid === BigInt(expected.uid)
    && actual.gid === BigInt(expected.gid)
    && actual.size === BigInt(expected.size)
    && actual.mtimeNs === BigInt(expected.mtimeNs)
    && actual.ctimeNs === BigInt(expected.ctimeNs)
  );
}

async function readStdinExactly(bytes: number, expectedSha256: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of process.stdin) {
    const chunk = Buffer.from(rawChunk);
    total += chunk.byteLength;
    if (total > bytes) throw new PublishFailure("INPUT_MISMATCH", "Pinned publisher received more bytes than declared.");
    chunks.push(chunk);
  }
  const payload = Buffer.concat(chunks, total);
  const actualSha256 = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  if (total !== bytes || actualSha256 !== expectedSha256) {
    throw new PublishFailure("INPUT_MISMATCH", "Pinned publisher input length or hash did not match its request.");
  }
  return payload;
}

async function readBoundedHandle(handle: FileHandle, maximumBytes: number, fromStart = false): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maximumBytes) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, fromStart ? total : null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  return Buffer.concat(chunks, total);
}

async function inspectTarget(request: PublishRequest): Promise<void> {
  let current: BigIntStats | undefined;
  try {
    current = await lstat(request.destination, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (request.expectedTarget.kind === "absent") {
    if (current === undefined) return;
    if (
      request.sourceIdentity !== undefined
      && current.dev === BigInt(request.sourceIdentity.dev)
      && current.ino === BigInt(request.sourceIdentity.ino)
    ) throw new PublishFailure("HARDLINK_ALIAS", "Candidate output is a hard-link alias of its source.");
    throw new PublishFailure("DESTINATION_EXISTS", "Destination already exists.");
  }
  if (
    current === undefined
    || !current.isFile()
    || current.isSymbolicLink()
    || !identityMatches(request.expectedTarget.identity, current)
  ) throw new PublishFailure("TARGET_CHANGED", "Destination changed after admission.");
  if (request.expectedTarget.sha256 === undefined) return;
  const maximumBytes = request.expectedTarget.maximumBytes;
  if (maximumBytes === undefined || current.size > BigInt(maximumBytes)) {
    throw new PublishFailure("TARGET_CHANGED", "Destination exceeded its admitted byte bound.");
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(request.destination, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!identityMatches(request.expectedTarget.identity, before)) throw new PublishFailure("TARGET_CHANGED", "Destination changed after admission.");
    const bytes = await readBoundedHandle(handle, maximumBytes);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(request.destination, { bigint: true });
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (
      bytes.byteLength > maximumBytes
      || !identityMatches(request.expectedTarget.identity, after)
      || !identityMatches(request.expectedTarget.identity, pathAfter)
      || sha256 !== request.expectedTarget.sha256
    ) throw new PublishFailure("TARGET_CHANGED", "Destination changed after admission.");
  } finally {
    await handle?.close();
  }
}

async function createPrivateTemporary(): Promise<Readonly<{ name: string; handle: FileHandle }>> {
  // Keep the helper name independent of the destination basename. A valid
  // 255-byte destination must not become unpublishable merely because the
  // private staging name appends more bytes to it.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const name = `.armorial-publish-${randomBytes(12).toString("hex")}.tmp`;
    try {
      const handle = await open(
        name,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
        0o600,
      );
      return { name, handle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new PublishFailure("TEMPORARY_NAME_COLLISION", "Pinned publisher could not allocate a private temporary file.");
}

async function awaitParentCommit(request: PublishRequest): Promise<void> {
  if (typeof process.send !== "function" || !process.connected) {
    throw new PublishFailure("PARENT_CANCELLED", "CLI parent disappeared before publication authorization.");
  }
  await new Promise<void>((resolveCommit, reject) => {
    let settled = false;
    const finish = (error?: PublishFailure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off("message", onMessage);
      process.off("disconnect", onDisconnect);
      // Once a decision arrives, the IPC channel has served its purpose. A
      // rejected publication must not stay alive solely because its former
      // parent channel is still referenced, and a committed publication has
      // crossed the explicitly documented interruption boundary.
      if (process.connected) process.disconnect();
      if (error === undefined) resolveCommit();
      else reject(error);
    };
    const onDisconnect = () => finish(new PublishFailure(
      "PARENT_CANCELLED",
      "CLI parent disconnected before publication authorization.",
    ));
    const onMessage = (message: unknown) => {
      const commit = message as {
        version?: unknown;
        action?: unknown;
        sha256?: unknown;
        commitToken?: unknown;
      };
      if (
        commit.version !== 1
        || !["commit", "abort"].includes(String(commit.action))
        || commit.sha256 !== request.inputSha256
        || commit.commitToken !== request.commitToken
      ) {
        finish(new PublishFailure("INVALID_COMMIT", "CLI parent sent an invalid publication authorization."));
        return;
      }
      if (commit.action === "abort") {
        finish(new PublishFailure("PARENT_CANCELLED", "CLI parent cancelled publication before commit."));
        return;
      }
      finish();
    };
    const timer = setTimeout(() => finish(new PublishFailure(
      "PARENT_CANCELLED",
      "CLI parent did not authorize publication before the commit deadline.",
    )), MAX_PARENT_COMMIT_WAIT_MS);
    process.once("message", onMessage);
    process.once("disconnect", onDisconnect);
    process.send!({
      status: "ready",
      version: 1,
      bytes: request.inputBytes,
      sha256: request.inputSha256,
      commitToken: request.commitToken,
    }, (error) => {
      if (error !== null) finish(new PublishFailure(
        "PARENT_CANCELLED",
        "CLI parent could not receive publication readiness.",
      ));
    });
  });
}

async function main(): Promise<void> {
  const request = parseRequest(process.argv[2]);
  // The OS resolves cwd before this module starts. This first filesystem
  // observation proves that every later relative operation is anchored to the
  // exact admitted directory inode, even if its path is replaced afterwards.
  const parent = await stat(".", { bigint: true });
  if (
    !parent.isDirectory()
    || parent.dev !== decimal(request.expectedParent.dev, "expectedParent.dev")
    || parent.ino !== decimal(request.expectedParent.ino, "expectedParent.ino")
  ) throw new PublishFailure("PARENT_CHANGED", "Destination parent directory changed before publication.");

  const payload = await readStdinExactly(request.inputBytes, request.inputSha256);
  await inspectTarget(request);
  let temporary: string | undefined;
  let handle: FileHandle | undefined;
  let preparedTemporaryIdentity: BigIntStats | undefined;
  let published = false;
  let cleanupWarning: string | undefined;
  let failure: unknown;
  let cleanup: PublicationFailureState["cleanup"] = { status: "not_needed" };
  try {
    const created = await createPrivateTemporary();
    temporary = created.name;
    handle = created.handle;
    // Staging stays owner-private regardless of the final output mode. The
    // requested destination mode is applied only after commit authorization.
    await handle.chmod(0o600);
    if (payload.byteLength > 0) await handle.writeFile(payload);
    await handle.sync();
    const temporaryIdentity = await handle.stat({ bigint: true });
    preparedTemporaryIdentity = temporaryIdentity;
    const verifiedBytes = await readBoundedHandle(handle, request.inputBytes, true);
    const verifiedSha256 = `sha256:${createHash("sha256").update(verifiedBytes).digest("hex")}`;
    if (
      temporaryIdentity.size !== BigInt(request.inputBytes)
      || verifiedBytes.byteLength !== request.inputBytes
      || verifiedSha256 !== request.inputSha256
    ) throw new PublishFailure("TEMPORARY_CHANGED", "Pinned publisher temporary bytes did not match the admitted payload.");
    const temporaryPathIdentity = await lstat(temporary, { bigint: true });
    if (
      temporaryIdentity.dev !== temporaryPathIdentity.dev
      || temporaryIdentity.ino !== temporaryPathIdentity.ino
      || !temporaryPathIdentity.isFile()
      || temporaryPathIdentity.isSymbolicLink()
    ) throw new PublishFailure("TEMPORARY_CHANGED", "Pinned publisher temporary file changed before publication.");
    // Closing is part of preparing the private candidate. Resolve it before
    // the parent can authorize any final-path mutation so a close failure is
    // still a truthful, non-publishing failure.
    await handle.close();
    handle = undefined;
    const closedTemporaryIdentity = await lstat(temporary, { bigint: true });
    if (
      temporaryIdentity.dev !== closedTemporaryIdentity.dev
      || temporaryIdentity.ino !== closedTemporaryIdentity.ino
      || temporaryIdentity.mode !== closedTemporaryIdentity.mode
      || temporaryIdentity.size !== closedTemporaryIdentity.size
      || !closedTemporaryIdentity.isFile()
      || closedTemporaryIdentity.isSymbolicLink()
    ) throw new PublishFailure("TEMPORARY_CHANGED", "Pinned publisher temporary file changed after close.");
    await inspectTarget(request);
    // Preparation has no durable final-path effect. The helper commits only
    // after its still-live CLI parent validates this bounded readiness message.
    // IPC closure caused by parent-only cancellation closes this path and the
    // finally block removes the private temporary file.
    await awaitParentCommit(request);
    await chmod(temporary, request.mode);
    const publicationTemporaryIdentity = await lstat(temporary, { bigint: true });
    if (
      publicationTemporaryIdentity.dev !== temporaryIdentity.dev
      || publicationTemporaryIdentity.ino !== temporaryIdentity.ino
      || !publicationTemporaryIdentity.isFile()
      || publicationTemporaryIdentity.isSymbolicLink()
      || Number(publicationTemporaryIdentity.mode & 0o777n) !== request.mode
    ) throw new PublishFailure("TEMPORARY_CHANGED", "Pinned publisher temporary file changed during publication.");
    await inspectTarget(request);
    if (request.operation === "create") await link(temporary, request.destination);
    else await rename(temporary, request.destination);
    published = true;
  } catch (error) {
    if (
      request.operation === "create"
      && (error as NodeJS.ErrnoException).code === "EEXIST"
    ) failure = new PublishFailure("DESTINATION_EXISTS", "Destination appeared during publication.");
    else failure = error;
  } finally {
    try {
      await handle?.close();
    } catch (error) {
      if (failure === undefined) failure = error;
    }
    // An open failure creates no file and therefore owns nothing to clean.
    // If both publication and cleanup fail, preserve the publication failure:
    // cleanup diagnostics must never replace the causal error.
    if (temporary !== undefined) {
      try {
        await rm(temporary, { force: true });
        cleanup = { status: "complete" };
      } catch (error) {
        cleanup = await failedCleanupState(error, temporary, preparedTemporaryIdentity, request.inputBytes);
        if (published) cleanupWarning = "Published output is valid, but its private temporary hard-link name could not be removed.";
        else if (failure === undefined) failure = new PublishFailure("TEMPORARY_CLEANUP_FAILED", "Pinned publisher could not remove its unpublished temporary file.");
      }
    }
  }
  if (failure !== undefined) {
    const causal = failure instanceof PublishFailure
      ? failure
      : new PublishFailure("HELPER_FAILED", failureMessage(failure));
    throw new PublishFailure(causal.code, causal.message, {
      effect: "none",
      cleanup,
    });
  }
  process.stdout.write(boundedJson({
    status: "ok",
    bytes: payload.byteLength,
    sha256: request.inputSha256,
    publisherMaxRssBytes: process.resourceUsage().maxRSS * 1024,
    ...(cleanupWarning === undefined ? {} : { cleanupWarning }),
  }));
}

main().catch((error: unknown) => {
  const expected = error instanceof PublishFailure;
  const failure = expected
    ? error
    : new PublishFailure("HELPER_FAILED", error instanceof Error ? error.message : "Pinned publisher failed unexpectedly.");
  process.stderr.write(boundedJson({
    status: "error",
    code: failure.code,
    message: failure.message,
    ...(failure.publication === undefined ? {} : { publication: failure.publication }),
  }));
  process.exitCode = expected ? 2 : 1;
});
