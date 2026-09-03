import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { IconKernelError } from "../core/errors.js";

const MAX_INLINE_HTML_BYTES = 8 * 1024 * 1024;
const SPRITE_START_MARKER = "<!-- armorial:sprite:start -->";
const SPRITE_END_MARKER = "<!-- armorial:sprite:end -->";

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
  return { workingRoot, destination, mode: current.mode & 0o777 };
}

async function replaceFileAtomically(destination: string, serialized: string, mode: number): Promise<void> {
  const temporary = join(dirname(destination), `.${basename(destination)}.armorial-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await chmod(temporary, mode);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function inlineSpriteIntoHtml(
  inputPath: string,
  sprite: string,
  symbolCount: number,
  resolved?: readonly ResolvedIntent[],
  allowSymbolRemoval = false,
): Promise<void> {
  const { workingRoot, destination, mode } = await resolveExistingTaskFile(inputPath, /\.html?$/i, "inline-into");
  const original = await readFile(destination, "utf8");
  if (Buffer.byteLength(original) > MAX_INLINE_HTML_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `inline-into HTML must not exceed ${MAX_INLINE_HTML_BYTES} bytes.`,
      field: "inline-into",
    });
  }

  const starts = original.split(SPRITE_START_MARKER).length - 1;
  const ends = original.split(SPRITE_END_MARKER).length - 1;
  if (starts !== ends || starts > 1) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "inline-into HTML contains an incomplete or duplicate Armorial sprite block.",
      field: "inline-into",
    });
  }

  const block = `${SPRITE_START_MARKER}\n${sprite}\n${SPRITE_END_MARKER}`;
  let serialized: string;
  if (starts === 1) {
    const start = original.indexOf(SPRITE_START_MARKER);
    const end = original.indexOf(SPRITE_END_MARKER, start) + SPRITE_END_MARKER.length;
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
    const indentation = original.slice(lineStart, start);
    if (!/^\s*$/.test(indentation)) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "inline-into Armorial sprite marker must start on its own line.",
        field: "inline-into",
      });
    }
    serialized = `${original.slice(0, start)}${block.replaceAll("\n", `\n${indentation}`)}${original.slice(end)}`;
  } else {
    const bodyTags = [...original.matchAll(/<body(?:\s[^>]*)?>/gi)];
    if (bodyTags.length !== 1 || bodyTags[0]?.index === undefined) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: "inline-into HTML must contain exactly one body opening tag.",
        field: "inline-into",
      });
    }
    const insertion = bodyTags[0].index + bodyTags[0][0].length;
    serialized = `${original.slice(0, insertion)}\n  ${block.replaceAll("\n", "\n  ")}\n${original.slice(insertion)}`;
  }

  await replaceFileAtomically(destination, serialized, mode);
  writeJson({
    status: "ok",
    kind: "icon_sprite_inline",
    output: relative(workingRoot, destination) || basename(destination),
    bytes: Buffer.byteLength(serialized),
    sha256: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    symbols: symbolCount,
    ...(resolved === undefined ? {} : { resolved }),
  });
}
