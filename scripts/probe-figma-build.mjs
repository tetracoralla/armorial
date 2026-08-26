import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const projectRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(projectRoot, "figma-plugin/manifest.json");
const uiPath = resolve(projectRoot, "figma-plugin/dist/ui.html");
const mainPath = resolve(projectRoot, "figma-plugin/dist/main.js");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.name, "Armorial");
assert.match(manifest.id, /^\d{10,24}$/);
assert.deepEqual(manifest.editorType, ["figma"]);
assert.equal(manifest.documentAccess, "dynamic-page");
assert.deepEqual(manifest.networkAccess, { allowedDomains: ["none"] });
assert.equal(manifest.main, "dist/main.js");
assert.equal(manifest.ui, "dist/ui.html");

const [uiStat, mainStat] = await Promise.all([stat(uiPath), stat(mainPath)]);
assert.ok(uiStat.size <= 5 * 1024 * 1024, `Figma UI bundle is ${uiStat.size} bytes`);
assert.ok(mainStat.size <= 256 * 1024, `Figma main bundle is ${mainStat.size} bytes`);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1160, height: 760 }, locale: "en-US" });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(pathToFileURL(uiPath).href);
  await page.getByText("2,658 icons").waitFor();
  await page.getByRole("heading", { name: "Figma output" }).waitFor();
  await page.getByRole("heading", { name: "Appearance" }).waitFor();
  await page.getByRole("button", { name: "Insert component" }).waitFor();

  // The Figma window already carries the "Armorial" title; the page itself
  // must not render a second, homemade title bar.
  assert.equal(await page.locator(".app-header").count(), 0);
  assert.equal(await page.getByText("Armorial", { exact: true }).count(), 0);
  assert.equal(await page.locator(".inspector code").count(), 0, "the Figma preview must not show the provider id");
  assert.equal(await page.getByText(/^Page:/).count(), 0, "the page label line is gone");

  // Mode controls are icon buttons in the search row, to the right of the input.
  const searchBox = page.getByRole("searchbox", { name: "Search icons" });
  const searchBoxBounds = await searchBox.boundingBox();
  const modeButtonBounds = await page.getByRole("button", { name: "Drag mode" }).boundingBox();
  assert.ok(searchBoxBounds && modeButtonBounds, "search box and mode button must be laid out");
  assert.ok(
    modeButtonBounds.x >= searchBoxBounds.x + searchBoxBounds.width,
    "the mode button must sit to the right of the search input",
  );

  // The catalog reflows fluidly: intermediate widths stay overflow-free and
  // keep changing the effective column count instead of snapping breakpoints.
  const columnCount = () => page.evaluate(() =>
    getComputedStyle(document.querySelector(".icon-grid")).gridTemplateColumns.split(" ").length);
  const overflowFree = () => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  const wideColumns = await columnCount();
  assert.ok(overflowFree(), "no horizontal overflow at the default 1160px width");
  for (const size of [{ width: 1024, height: 700 }, { width: 906, height: 640 }, { width: 660, height: 600 }]) {
    await page.setViewportSize(size);
    const columns = await columnCount();
    assert.ok(overflowFree(), `no horizontal overflow at ${size.width}px width`);
    assert.ok(columns >= 3, `grid keeps at least 3 columns at ${size.width}px width`);
  }
  await page.setViewportSize({ width: 1160, height: 760 });
  assert.equal(await columnCount(), wideColumns, "returning to the default width restores the same column count");
  const compactResize = page.evaluate(() => new Promise((resolveMessage) => {
    const listener = (event) => {
      if (event.data?.pluginMessage?.type === "resize-ui"
        && event.data.pluginMessage.mode === "compact") {
        window.removeEventListener("message", listener);
        resolveMessage(event.data.pluginMessage);
      }
    };
    window.addEventListener("message", listener);
  }));
  await page.getByRole("button", { name: "Drag mode" }).click();
  assert.equal((await compactResize).mode, "compact");
  await page.getByRole("button", { name: "Settings" }).waitFor();
  const fullResize = page.evaluate(() => new Promise((resolveMessage) => {
    const listener = (event) => {
      if (event.data?.pluginMessage?.type === "resize-ui"
        && event.data.pluginMessage.mode === "full") {
        window.removeEventListener("message", listener);
        resolveMessage(event.data.pluginMessage);
      }
    };
    window.addEventListener("message", listener);
  }));
  await page.getByRole("button", { name: "Settings" }).click();
  assert.equal((await fullResize).mode, "full");
  await page.getByRole("button", { name: "Drag mode" }).waitFor();

  await page.evaluate(() => {
    window.postMessage({
      pluginMessage: {
        type: "state",
        settings: {
          createComponent: true,
          outlineStroke: false,
          layerStructure: "preserve",
          layerName: "icon-name",
        },
        render: { size: 40, strokeLinecap: "square" },
        locale: "system",
        pageName: "Armorial Plugin Acceptance",
      },
    }, "*");
  });
  await page.getByLabel("Size value").waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Size value"]')?.value === "40");
  assert.equal(await page.getByLabel("Size value").inputValue(), "40");
  const firstIcon = page.getByRole("option").first();
  assert.equal(await firstIcon.getAttribute("draggable"), "false");
  await page.waitForFunction(() => document.querySelector('[role="option"]')?.getAttribute("draggable") === "true");

  const savedRender = page.evaluate(() => new Promise((resolveMessage) => {
    const listener = (event) => {
      if (event.data?.pluginMessage?.type === "save-render"
        && event.data.pluginMessage.render?.theme === "filled") {
        window.removeEventListener("message", listener);
        resolveMessage(event.data.pluginMessage);
      }
    };
    window.addEventListener("message", listener);
  }));
  await page.getByLabel("Theme").selectOption("filled");
  assert.equal((await savedRender).render.theme, "filled");
  assert.equal(await firstIcon.getAttribute("draggable"), "false");
  await page.waitForFunction(() => document.querySelector('[role="option"]')?.getAttribute("draggable") === "true");

  const savedOutput = page.evaluate(() => new Promise((resolveMessage) => {
    const listener = (event) => {
      if (event.data?.pluginMessage?.type === "save-settings"
        && event.data.pluginMessage.settings?.layerStructure === "flatten") {
        window.removeEventListener("message", listener);
        resolveMessage(event.data.pluginMessage);
      }
    };
    window.addEventListener("message", listener);
  }));
  await page.getByLabel("Layer structure").selectOption("flatten");
  assert.equal((await savedOutput).settings.layerStructure, "flatten");

  await page.getByRole("searchbox", { name: "Search icons" }).fill("notification");
  await page.getByText("remind", { exact: true }).first().waitFor();

  const capturedDrop = page.evaluate(async () => {
    let observedDrop = null;
    let resolveDrop;
    const dropPromise = new Promise((resolve) => {
      resolveDrop = resolve;
    });
    window.addEventListener("message", (event) => {
      if (!event.data?.pluginDrop) return;
      observedDrop = event.data.pluginDrop;
      resolveDrop(event.data.pluginDrop);
    });

    const icon = document.querySelector('[role="option"]');
    const insideDrag = new DragEvent("dragend", { clientX: 120, clientY: 100, bubbles: true });
    icon?.dispatchEvent(insideDrag);
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (observedDrop !== null) throw new Error("A drag ending inside the picker emitted pluginDrop");

    const outsideDrag = new DragEvent("dragend", { clientX: 200, clientY: 160, bubbles: true });
    Object.defineProperty(outsideDrag, "view", { value: { length: 1 } });
    icon?.dispatchEvent(outsideDrag);
    return dropPromise;
  });
  const drop = await capturedDrop;
  assert.equal(drop.dropMetadata.source, "armorial");
  assert.equal(drop.items[0].type, "image/svg+xml");
  assert.match(drop.items[0].data, /<svg/);

  await page.getByRole("button", { name: "Drag mode" }).click();
  await page.getByRole("button", { name: "Settings" }).waitFor();
  await page.evaluate(() => {
    window.postMessage({
      pluginMessage: {
        type: "insert-result",
        receipt: {
          requestId: "probe-drop",
          nodeId: "12:34",
          nodeType: "FRAME",
          nodeName: "Vector",
          parentId: "12:1",
          parentName: "Drop target",
          placement: "drop",
          component: false,
          outlinedNodeCount: 1,
          layerStructure: "flatten",
        },
      },
    }, "*");
  });
  await page.getByText("Placed Vector in Drop target").waitFor();

  await page.evaluate(() => {
    window.postMessage({
      pluginMessage: {
        type: "operation-error",
        requestId: null,
        message: "Drop could not be placed.",
      },
    }, "*");
  });
  await page.getByRole("alert").getByText("Drop could not be placed.").waitFor();
  assert.deepEqual(pageErrors, []);
} finally {
  await browser.close();
}

console.log(`Figma plugin probe passed (${uiStat.size} B UI, ${mainStat.size} B main).`);
