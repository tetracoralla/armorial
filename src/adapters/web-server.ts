#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { KERNEL_VERSION, type BrowseIconsInput, type GetIconInput } from "../core/contracts.js";
import { IconKernelError, toKernelError } from "../core/errors.js";
import { IconKernel } from "../core/kernel.js";
import { isMainModule } from "./main-module.js";
import { resolvePolicyInput } from "./policy-file.js";

const MAX_HTTP_BODY_BYTES = 16 * 1024;
const DEFAULT_PORT = 4178;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: "Use Content-Type: application/json.",
    });
  }

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_BODY_BYTES) {
    throw new IconKernelError({
      code: "INVALID_INPUT",
      message: `Request body exceeds the ${MAX_HTTP_BODY_BYTES}-byte limit.`,
    });
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_HTTP_BODY_BYTES) {
      throw new IconKernelError({
        code: "INVALID_INPUT",
        message: `Request body exceeds the ${MAX_HTTP_BODY_BYTES}-byte limit.`,
      });
    }
    chunks.push(bytes);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new IconKernelError({ code: "INVALID_INPUT", message: "Request body is not valid JSON." });
  }
}

export async function resolveStaticAssetPath(staticRoot: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (relativePath.includes("\0") || relativePath.split("/").includes("..")) {
    return null;
  }

  const root = await realpath(staticRoot);
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return null;
  }

  try {
    const target = await realpath(candidate);
    const targetStat = await stat(target);
    if (!targetStat.isFile() || (target !== root && !target.startsWith(`${root}${sep}`))) throw new Error("Invalid file");
    return target;
  } catch {
    return null;
  }
}

async function serveStatic(
  response: ServerResponse,
  pathname: string,
  staticRoot: string,
  method: string,
): Promise<void> {
  const target = await resolveStaticAssetPath(staticRoot, pathname);
  if (target === null) {
    response.statusCode = 404;
    response.end(method === "HEAD" ? undefined : "Not found");
    return;
  }
  const targetStat = await stat(target);

  response.statusCode = 200;
  response.setHeader("Content-Length", targetStat.size);
  response.setHeader("Content-Type", MIME_TYPES[extname(target)] ?? "application/octet-stream");
  if (method === "HEAD") {
    response.end();
    return;
  }
  const fileStream = createReadStream(target);
  fileStream.on("error", () => {
    if (!response.headersSent) {
      const body = "Internal server error";
      response.statusCode = 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Content-Length", Buffer.byteLength(body));
      response.end(body);
    } else {
      response.destroy();
    }
  });
  fileStream.pipe(response);
}

// The kernel reports unexpected internal failures as error outputs (the new
// INTERNAL_ERROR code), not as thrown exceptions, so the status decision must
// inspect the output's error code; only thrown adapter-side failures reach the
// outer catch.
function apiResponseStatus(output: { status: string; error?: { code?: string } }): number {
  if (output.status !== "error") return 200;
  return output.error?.code === "INTERNAL_ERROR" ? 500 : 400;
}

export function createIconWebServer(
  kernel: IconKernel,
  staticRoot = resolve(import.meta.dirname, "../web"),
): Server {
  return createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api/health" && request.method === "GET") {
        writeJson(response, 200, { status: "ok", version: KERNEL_VERSION });
        return;
      }
      if (url.pathname === "/favicon.ico" && (request.method === "GET" || request.method === "HEAD")) {
        // The page ships an inline data-URI icon; answer legacy .ico requests
        // with no content instead of static-file 404 noise.
        response.statusCode = 204;
        response.end();
        return;
      }
      if (url.pathname === "/api/browse" && request.method === "POST") {
        const output = kernel.browse(await readJsonBody(request) as BrowseIconsInput);
        writeJson(response, apiResponseStatus(output), { result: output });
        return;
      }
      if (url.pathname === "/api/get" && request.method === "POST") {
        const output = kernel.getIcon(await readJsonBody(request) as GetIconInput);
        writeJson(response, apiResponseStatus(output), { result: output });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        writeJson(response, 404, { status: "error", error: { code: "INVALID_INPUT", message: "Unknown API route." } });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.statusCode = 405;
        response.end("Method not allowed");
        return;
      }
      await serveStatic(response, url.pathname, staticRoot, request.method);
    } catch (error) {
      const kernelError = toKernelError(error);
      // Client-caused failures are 4xx; unexpected internal failures must not
      // masquerade as client errors.
      writeJson(response, kernelError.code === "INTERNAL_ERROR" ? 500 : 400, { status: "error", error: kernelError });
    }
  });
}

export async function listenIconWebServer(
  server: Server,
  port = DEFAULT_PORT,
): Promise<{ host: "127.0.0.1"; port: number; url: string }> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Local UI server did not expose a TCP address.");
  return { host: "127.0.0.1", port: address.port, url: `http://127.0.0.1:${address.port}` };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      policy: { type: "string" },
      port: { type: "string" },
    },
  });
  const port = parsed.values.port === undefined
    ? DEFAULT_PORT
    : (/^\d+$/.test(parsed.values.port) ? Number.parseInt(parsed.values.port, 10) : Number.NaN);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new IconKernelError({ code: "INVALID_INPUT", message: "Port must be an integer from 0 to 65535.", field: "port" });
  }
  const policy = await resolvePolicyInput(parsed.values.policy);
  const server = createIconWebServer(new IconKernel(policy));
  const address = await listenIconWebServer(server, port);
  process.stdout.write(`${JSON.stringify({ status: "ok", kind: "icon_ui_server", ...address })}\n`);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ status: "error", error: toKernelError(error) })}\n`);
    process.exitCode = 1;
  });
}
