import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { IconKernel } from "../src/core/kernel.js";
import { createIconWebServer, listenIconWebServer, resolveStaticAssetPath } from "../src/adapters/web-server.js";

test("static UI resolution serves only real files inside the built UI root", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "icon-svg-select-web-"));
  const outside = await mkdtemp(join(tmpdir(), "icon-svg-select-outside-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  });

  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html>");
  await writeFile(join(root, "assets", "app.js"), "export {};");
  await writeFile(join(outside, "secret.txt"), "not public");
  await symlink(join(outside, "secret.txt"), join(root, "assets", "escape.txt"));

  assert.equal(await resolveStaticAssetPath(root, "/"), await realpath(join(root, "index.html")));
  assert.equal(await resolveStaticAssetPath(root, "/assets/app.js"), await realpath(join(root, "assets", "app.js")));
  assert.equal(await resolveStaticAssetPath(root, "/../secret.txt"), null);
  assert.equal(await resolveStaticAssetPath(root, "/%2e%2e/secret.txt"), null);
  assert.equal(await resolveStaticAssetPath(root, "/assets/escape.txt"), null);
  assert.equal(await resolveStaticAssetPath(root, "/missing.js"), null);
});

test("HEAD requests return headers without a body", async (context) => {
  const staticRoot = await mkdtemp(join(tmpdir(), "icon-svg-select-head-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><p>icon workbench</p>");
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(staticRoot, { recursive: true, force: true });
  });
  const server = createIconWebServer(new IconKernel(), staticRoot);
  context.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = await listenIconWebServer(server, 0);

  const head = await fetch(`${address.url}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(await head.text(), "");

  const headMissing = await fetch(`${address.url}/missing-page`, { method: "HEAD" });
  assert.equal(headMissing.status, 404);
  assert.equal(await headMissing.text(), "");
});

test("static stream failures replace stale asset headers with a complete 500 response", async (context) => {
  const staticRoot = await mkdtemp(join(tmpdir(), "icon-svg-select-stream-error-"));
  const blockedFile = join(staticRoot, "blocked.txt");
  await writeFile(blockedFile, "secret");
  await chmod(blockedFile, 0);
  context.after(async () => {
    await chmod(blockedFile, 0o600);
    const { rm } = await import("node:fs/promises");
    await rm(staticRoot, { recursive: true, force: true });
  });
  try {
    await readFile(blockedFile);
    context.skip("This filesystem identity can read mode-000 files.");
    return;
  } catch {
    // Expected: the server can stat the path but createReadStream will fail.
  }
  const server = createIconWebServer(new IconKernel(), staticRoot);
  context.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = await listenIconWebServer(server, 0);

  const response = await fetch(`${address.url}/blocked.txt`);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
  assert.equal(await response.text(), "Internal server error");
});

test("favicon requests return no content instead of static 404 noise", async (context) => {
  const server = createIconWebServer(new IconKernel());
  context.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = await listenIconWebServer(server, 0);

  const favicon = await fetch(`${address.url}/favicon.ico`);
  assert.equal(favicon.status, 204);
  assert.equal(await favicon.text(), "");
});

test("unexpected handler failures report HTTP 500 with INTERNAL_ERROR", async (context) => {
  const kernel = new IconKernel();
  (kernel as unknown as { browse: () => never }).browse = () => {
    throw new Error("boom");
  };
  const server = createIconWebServer(kernel);
  context.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = await listenIconWebServer(server, 0);

  const response = await fetch(`${address.url}/api/browse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset: 0, limit: 8 }),
  });
  assert.equal(response.status, 500);
  const payload = await response.json() as { status: string; error: { code: string } };
  assert.equal(payload.status, "error");
  assert.equal(payload.error.code, "INTERNAL_ERROR");
});

test("kernel-internal failures returned as outputs also report HTTP 500", async (context) => {
  const kernel = new IconKernel();
  // The kernel catches unexpected failures and returns them as INTERNAL_ERROR
  // outputs instead of throwing, so the adapter must inspect the output code.
  (kernel as unknown as { searchIndex: unknown }).searchIndex = new Proxy({}, {
    get() {
      throw new TypeError("boom");
    },
  });
  const server = createIconWebServer(kernel);
  context.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = await listenIconWebServer(server, 0);

  const response = await fetch(`${address.url}/api/browse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "search", offset: 0, limit: 8 }),
  });
  assert.equal(response.status, 500);
  const payload = await response.json() as { result?: { status?: string; error?: { code?: string } } };
  assert.equal(payload.result?.status, "error");
  assert.equal(payload.result?.error?.code, "INTERNAL_ERROR");
});
