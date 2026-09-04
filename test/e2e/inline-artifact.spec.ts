import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("built CLI preserves executable HTML and publishes resolvable inline symbols", async ({ page }) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-inline-browser-"));
  try {
    const target = resolve(scratch, "index.html");
    const candidate = resolve(scratch, "index.armorial.html");
    const original = [
      "<!doctype html>",
      "<HTML><HEAD><!-- template body: <body> --><title>Inline fixture</title><script>",
      'window.fakeBody = "<body>";',
      "window.fixtureRuns = (window.fixtureRuns || 0) + 1;",
      "</script></HEAD>",
      "<BoDy class=\"app\" data-fixture=\"kept\">",
      '<main><svg width="48" height="48"><use href="#armorial-search"></use></svg></main>',
      "</BoDy></HTML>",
      "",
    ].join("\n");
    await writeFile(target, original, "utf8");

    const cli = resolve(workspace, "dist/adapters/cli.js");
    const result = spawnSync(process.execPath, [
      cli,
      "batch",
      "icon-park:search",
      "--format",
      "sprite",
      "--inline-from",
      "index.html",
      "--output",
      "index.armorial.html",
    ], { cwd: scratch, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/<svg|<symbol|<path/);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "ok",
      kind: "icon_sprite_inline_candidate",
      source: "index.html",
      output: "index.armorial.html",
      protectionLevel: "non_overwriting_candidate",
      symbols: 1,
    });

    expect(await readFile(target, "utf8")).toBe(original);
    const serialized = await readFile(candidate, "utf8");
    expect(serialized).toMatch(/^<!doctype html>\n<HTML><HEAD>/);
    expect(serialized).toContain('window.fakeBody = "<body>";');
    expect(serialized).toContain('<BoDy class="app" data-fixture="kept">\n  <!-- armorial:sprite:start -->');

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(pathToFileURL(candidate).href);
    const runtime = await page.evaluate(() => {
      const use = document.querySelector("use") as SVGGraphicsElement | null;
      const box = use?.getBBox();
      return {
        fixtureRuns: (window as unknown as { fixtureRuns?: number }).fixtureRuns,
        fakeBody: (window as unknown as { fakeBody?: string }).fakeBody,
        bodyFixture: document.body.dataset.fixture,
        symbolCount: document.querySelectorAll("symbol").length,
        targetExists: document.querySelector("#armorial-search") !== null,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
      };
    });
    expect(pageErrors).toEqual([]);
    expect(runtime).toMatchObject({
      fixtureRuns: 1,
      fakeBody: "<body>",
      bodyFixture: "kept",
      symbolCount: 1,
      targetExists: true,
    });
    expect(runtime.width).toBeGreaterThan(0);
    expect(runtime.height).toBeGreaterThan(0);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
