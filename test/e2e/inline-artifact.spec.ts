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

test("metadata choices and an explicit ambiguous choice become working accessible controls", async ({ page }) => {
  const scratch = await mkdtemp(resolve(tmpdir(), "armorial-choice-consumer-"));
  const cli = resolve(workspace, "dist/adapters/cli.js");
  const cliEnvironment = { ...process.env };
  delete cliEnvironment.FORCE_COLOR;
  try {
    const selection = spawnSync(process.execPath, [cli, "select", "search", "settings", "关闭"], { cwd: scratch, encoding: "utf8", env: cliEnvironment });
    expect(selection.status).toBe(2);
    expect(selection.stderr).toBe("");
    expect(selection.stdout).not.toContain("<svg");
    const choices = JSON.parse(selection.stdout);
    expect(choices.status).toBe("partial");
    expect(choices.items[2].candidates.some((item: { id: string }) => item.id === "icon-park:close")).toBe(true);
    // The consumer deliberately chooses a candidate; successful meanings are not re-resolved.
    const ids = [choices.items[0].id, choices.items[1].id, "icon-park:close"] as string[];
    const labels = ["Search", "Settings", "Close"];
    const original = `<!doctype html><html lang="en"><head><title>Settings toolbar</title></head><body>
      <nav aria-label="Settings actions">${ids.map((id, index) => `<button type="button" aria-label="${labels[index]}" onclick="document.querySelector('output').textContent=this.getAttribute('aria-label')"><svg width="24" height="24" aria-hidden="true"><use href="#armorial-${id.replace('icon-park:', '')}" /></svg></button>`).join('')}</nav><output aria-live="polite"></output></body></html>`;
    await writeFile(resolve(scratch, "toolbar.html"), original);
    const published = spawnSync(process.execPath, [cli, "batch", ...ids, "--inline-from", "toolbar.html", "--output", "toolbar.icons.html"], { cwd: scratch, encoding: "utf8", env: cliEnvironment });
    expect(published.status, published.stderr).toBe(0);
    expect(published.stdout).not.toMatch(/<svg|<symbol|<path/);
    expect(await readFile(resolve(scratch, "toolbar.html"), "utf8")).toBe(original);
    await page.goto(pathToFileURL(resolve(scratch, "toolbar.icons.html")).href);
    const rendered = await page.locator("button use").evaluateAll((uses) => uses.map((use) => {
      const box = (use as SVGGraphicsElement).getBBox();
      return { target: document.querySelector(use.getAttribute("href")!) !== null, visible: box.width > 0 && box.height > 0 };
    }));
    expect(rendered).toEqual(ids.map(() => ({ target: true, visible: true })));
    expect(await page.locator("symbol").count()).toBe(3);
    for (const label of labels) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.locator("output")).toHaveText(label);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
