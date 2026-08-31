import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";
import { hasExpectedDeployedContentType, localContentType } from "./pages-content-types.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const pagesRoot = resolve(projectRoot, ".pages-dist");
async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = await filesBelow(pagesRoot);
assert.ok(files.length >= 4, `Pages build contains only ${files.length} files`);
const totalBytes = (await Promise.all(files.map(async (path) => (await stat(path)).size)))
  .reduce((sum, size) => sum + size, 0);
assert.ok(totalBytes <= 5 * 1024 * 1024, `Pages build is ${totalBytes} bytes`);

const javascript = (await Promise.all(
  files.filter((path) => extname(path) === ".js").map((path) => readFile(path, "utf8")),
)).join("\n");
assert.doesNotMatch(javascript, /\/api\/browse/);

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    const filePath = resolve(pagesRoot, relativePath);
    if (filePath !== pagesRoot && !filePath.startsWith(`${pagesRoot}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": localContentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Pages probe server did not bind.");
const origin = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const page = await context.newPage();
  const errors = [];
  const apiRequests = [];
  const catalogRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) apiRequests.push(request.url());
    if (pathname.includes("icon-catalog")) catalogRequests.push(pathname);
  });

  await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(await page.title(), "Search and render project-aware IconPark SVGs locally — Armorial");
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://tetracoralla.github.io/armorial/");
  assert.equal(await page.locator('link[rel="help"]').getAttribute("href"), "./agent-selection.html");
  assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "index,follow");
  assert.equal(await page.locator('link[rel="describedby"]').getAttribute("href"), "./llms.txt");
  const [llmsResponse, selectionResponse, selectionHtmlResponse, sourceCommitResponse, robotsResponse, sitemapResponse] = await Promise.all([
    page.request.get(`${origin}/llms.txt`),
    page.request.get(`${origin}/agent-selection.txt`),
    page.request.get(`${origin}/agent-selection.html`),
    page.request.get(`${origin}/source-commit.txt`),
    page.request.get(`${origin}/robots.txt`),
    page.request.get(`${origin}/sitemap.xml`),
  ]);
  for (const response of [llmsResponse, selectionResponse, selectionHtmlResponse, sourceCommitResponse, sitemapResponse]) {
    assert.equal(response.ok(), true);
    assert.equal(
      hasExpectedDeployedContentType(new URL(response.url()).pathname, response.headers()["content-type"]),
      true,
      response.url(),
    );
  }
  assert.match(await llmsResponse.text(), /# Armorial/);
  assert.match(await selectionResponse.text(), /## Do not use Armorial for/);
  assert.match(await selectionHtmlResponse.text(), /<h2>Do not use Armorial for<\/h2>/);
  assert.equal(robotsResponse.status(), 404);
  assert.match(await sitemapResponse.text(), /agent-selection\.html/);
  const sourceCommit = await sourceCommitResponse.text();
  assert.match(sourceCommit, /^[0-9a-f]{40}\n$/);
  assert.equal(
    sourceCommit.trim(),
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim(),
  );

  const taskPage = await context.newPage();
  await taskPage.goto(`${origin}/agent-selection.html`, { waitUntil: "domcontentloaded" });
  assert.equal(await taskPage.locator('link[rel="canonical"]').getAttribute("href"), "https://tetracoralla.github.io/armorial/agent-selection.html");
  assert.equal(await taskPage.locator('link[rel="alternate"][type="text/plain"]').getAttribute("href"), "./agent-selection.txt");
  assert.equal(await taskPage.locator('meta[name="robots"]').getAttribute("content"), "index,follow");
  await taskPage.close();
  await page.getByText("2,658 icons", { exact: true }).waitFor();
  assert.deepEqual(catalogRequests, ["/assets/icon-catalog.json.gz"]);
  await page.getByPlaceholder("Search icons", { exact: true }).fill("notification");
  await page.getByRole("option", { name: "remind", exact: true }).click();
  await page.getByRole("heading", { name: "remind", exact: true }).waitFor();

  await page.getByLabel("Size value", { exact: true }).fill("32");
  await page.getByLabel("Size value", { exact: true }).press("Enter");
  await page.waitForFunction(() => document.querySelector(".preview-panel img")?.getAttribute("src")?.includes("width%3D%2232%22") === true);
  assert.match(await page.locator(".preview-panel img").getAttribute("src") ?? "", /width%3D%2232%22/);

  await page.getByRole("button", { name: "Copy SVG", exact: true }).click();
  const svg = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(svg, /<svg /);
  assert.match(svg, /width="32"/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  assert.equal((await downloadPromise).suggestedFilename(), "remind.svg");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("2,658 icons", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error === undefined ? resolveClose() : rejectClose(error)));
}

console.log(`Static Pages probe passed (${files.length} files, ${totalBytes} B; no API requests).`);
