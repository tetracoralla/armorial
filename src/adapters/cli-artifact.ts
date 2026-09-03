import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { IconKernelError } from "../core/errors.js";

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

export type ResolvedIntent = Readonly<{ intent: string; id: string }>;

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function pathIsInside(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
}

export async function writeSpriteFile(
  outputPath: string,
  sprite: string,
  symbolCount: number,
  resolved?: readonly ResolvedIntent[],
): Promise<void> {
  if (isAbsolute(outputPath) || !outputPath.toLowerCase().endsWith(".svg")) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "output must be a relative .svg path inside the current working directory.",
      field: "output",
    });
  }

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

  const destination = join(parentRoot, basename(logicalDestination));
  let mode = 0o644;
  try {
    const current = await lstat(destination);
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "output may replace only a regular file.",
        field: "output",
      });
    }
    mode = current.mode & 0o777;
  } catch (error) {
    if (error instanceof IconKernelError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const serialized = `${sprite}\n`;
  const temporary = join(parentRoot, `.${basename(destination)}.armorial-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await chmod(temporary, mode);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }

  writeJson({
    status: "ok",
    kind: "icon_sprite_file",
    output: relative(workingRoot, destination) || basename(destination),
    bytes: Buffer.byteLength(serialized),
    sha256: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    symbols: symbolCount,
    ...(resolved === undefined ? {} : { resolved }),
  });
}

async function resolveExistingTaskFile(inputPath: string, extension: RegExp, field: string): Promise<{
  workingRoot: string;
  destination: string;
  mode: number;
  size: number;
}> {
  if (isAbsolute(inputPath) || !extension.test(inputPath)) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `${field} must be a relative ${field === "inline-into" ? ".html or .htm" : ".svg"} path inside the current working directory.`,
      field,
    });
  }

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

  const destination = join(parentRoot, basename(logicalDestination));
  let current;
  try {
    current = await lstat(destination);
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
  return { workingRoot, destination, mode: current.mode & 0o777, size: current.size };
}

type FileChunk = string | Uint8Array;

async function replaceFileAtomically(
  destination: string,
  chunks: readonly FileChunk[],
  mode: number,
): Promise<Readonly<{ bytes: number; sha256: string }>> {
  const temporary = join(dirname(destination), `.${basename(destination)}.armorial-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o644);
    const hash = createHash("sha256");
    let bytes = 0;
    for (const chunk of chunks) {
      const buffer = typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      let written = 0;
      while (written < buffer.byteLength) {
        const result = await handle.write(buffer, written, buffer.byteLength - written, null);
        if (result.bytesWritten === 0) {
          throw new Error("Atomic HTML publication made no write progress.");
        }
        written += result.bytesWritten;
      }
      hash.update(buffer);
      bytes += buffer.byteLength;
    }
    await handle.close();
    handle = undefined;
    await chmod(temporary, mode);
    await rename(temporary, destination);
    return { bytes, sha256: `sha256:${hash.digest("hex")}` };
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

function byteOffsetAt(original: string, codeUnitOffset: number, leadingByteOffset: number): number {
  return leadingByteOffset + Buffer.byteLength(original.slice(0, codeUnitOffset), "utf8");
}

function boundedManagedBlock(block: string, indentation: string): string {
  const published = block.replaceAll("\n", `\n${indentation}`);
  if (Buffer.byteLength(published, "utf8") > MAX_INLINE_SPRITE_BLOCK_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `inline-into Armorial sprite block must not exceed ${MAX_INLINE_SPRITE_BLOCK_BYTES} bytes.`,
      field: "inline-into",
    });
  }
  return published;
}

export async function inlineSpriteIntoHtml(
  inputPath: string,
  sprite: string,
  symbolCount: number,
  resolved?: readonly ResolvedIntent[],
  allowSymbolRemoval = false,
): Promise<void> {
  const { workingRoot, destination, mode, size } = await resolveExistingTaskFile(inputPath, /\.html?$/i, "inline-into");
  if (size > MAX_INLINE_HTML_PHYSICAL_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `inline-into physical HTML must not exceed ${MAX_INLINE_HTML_PHYSICAL_BYTES} bytes.`,
      field: "inline-into",
    });
  }
  const originalBytes = await readFile(destination);
  if (originalBytes.byteLength !== size) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline-into HTML changed while it was being admitted; retry with a stable task file.",
      field: "inline-into",
    });
  }
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
      message: `inline-into caller-owned HTML must not exceed ${MAX_INLINE_HTML_CALLER_BYTES} bytes.`,
      field: "inline-into",
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
      message: "inline-into HTML must be valid UTF-8 so existing bytes can be preserved.",
      field: "inline-into",
    });
  }
  const structure = await parseHtmlCarrierStructure(original);

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
        message: `inline-into existing Armorial sprite block must not exceed ${MAX_INLINE_SPRITE_BLOCK_BYTES} bytes.`,
        field: "inline-into",
      });
    }
    const previousBlock = original.slice(start, end);
    const previousSymbols = [...previousBlock.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]!);
    const nextSymbols = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]!));
    const removedSymbols = previousSymbols.filter((id) => !nextSymbols.has(id));
    if (removedSymbols.length > 0 && !allowSymbolRemoval) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `inline-into would remove ${removedSymbols.length} existing Armorial symbols (${removedSymbols.slice(0, 8).join(", ")}${removedSymbols.length > 8 ? ", …" : ""}); rerun with the complete union or pass --allow-symbol-removal after confirming they are unused.`,
        field: "inline-into",
      });
    }
    const lineStart = original.lastIndexOf("\n", start - 1) + 1;
    if (start - lineStart > MAX_MARKER_INDENTATION_CODE_UNITS) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `inline-into Armorial sprite marker indentation must not exceed ${MAX_MARKER_INDENTATION_CODE_UNITS} UTF-16 code units.`,
        field: "inline-into",
      });
    }
    const indentation = original.slice(lineStart, start);
    if (!/^\s*$/.test(indentation)) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "inline-into Armorial sprite marker must start on its own line.",
        field: "inline-into",
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
      boundedManagedBlock(block, indentation),
      originalBytes.subarray(endByte),
    ];
  } else {
    callerOwnedBytes = originalBytes.byteLength;
    const insertion = structure.bodyContentStart;
    const insertionByte = byteOffsetAt(original, insertion, leadingByteOffset);
    chunks = [
      originalBytes.subarray(0, insertionByte),
      `${CANONICAL_INLINE_PREFIX}${boundedManagedBlock(block, "  ")}${CANONICAL_INLINE_SUFFIX}`,
      originalBytes.subarray(insertionByte),
    ];
  }

  if (callerOwnedBytes > MAX_INLINE_HTML_CALLER_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `inline-into caller-owned HTML must not exceed ${MAX_INLINE_HTML_CALLER_BYTES} bytes.`,
      field: "inline-into",
    });
  }
  const prospectiveBytes = chunks.reduce(
    (total, chunk) => total + (typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength),
    0,
  );
  if (prospectiveBytes > MAX_INLINE_HTML_PHYSICAL_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `inline-into published HTML must not exceed ${MAX_INLINE_HTML_PHYSICAL_BYTES} bytes.`,
      field: "inline-into",
    });
  }

  const publication = await replaceFileAtomically(destination, chunks, mode);
  writeJson({
    status: "ok",
    kind: "icon_sprite_inline",
    output: relative(workingRoot, destination) || basename(destination),
    bytes: publication.bytes,
    sha256: publication.sha256,
    symbols: symbolCount,
    ...(resolved === undefined ? {} : { resolved }),
  });
}
