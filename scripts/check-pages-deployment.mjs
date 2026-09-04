import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { hasExpectedDeployedContentType } from "./pages-content-types.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const pagesRoot = resolve(projectRoot, ".pages-dist");
const deploymentBase = process.env["ARMORIAL_PAGES_URL"] ?? "https://tetracoralla.github.io/armorial/";

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

async function compareDeployment() {
  const mismatches = [];
  const files = await filesBelow(pagesRoot);
  for (const localPath of files) {
    const name = relative(pagesRoot, localPath).split("\\").join("/");
    let response;
    try {
      response = await fetch(new URL(name, deploymentBase), {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      mismatches.push(`${name}: ${error instanceof Error ? error.message : "request failed"}`);
      continue;
    }
    if (!response.ok) {
      mismatches.push(`${name}: HTTP ${response.status}`);
      continue;
    }
    const contentType = response.headers.get("content-type");
    if (!hasExpectedDeployedContentType(name, contentType)) {
      mismatches.push(`${name}: unexpected Content-Type ${JSON.stringify(contentType)}`);
    }
    const [local, remote] = await Promise.all([
      readFile(localPath),
      response.arrayBuffer().then((value) => Buffer.from(value)),
    ]);
    if (!local.equals(remote)) mismatches.push(`${name}: content differs`);
  }
  try {
    const staleRobots = await fetch(new URL("robots.txt", deploymentBase), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (staleRobots.status !== 404) {
      mismatches.push(`robots.txt: expected HTTP 404, received ${staleRobots.status}; project-scoped robots policy is invalid`);
    }
  } catch (error) {
    mismatches.push(`robots.txt absence: ${error instanceof Error ? error.message : "request failed"}`);
  }
  if (files.length === 0) mismatches.push("local build contains no files");
  return { files: files.length, mismatches };
}

let result = { files: 0, mismatches: ["deployment not checked"] };
for (let attempt = 1; attempt <= 6; attempt += 1) {
  result = await compareDeployment();
  if (result.mismatches.length === 0) break;
  if (attempt < 6) await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
}

assert.deepEqual(result.mismatches, []);
console.log(`GitHub Pages: ${result.files} files match the local build with valid MIME types; no path-scoped robots policy is published.`);
