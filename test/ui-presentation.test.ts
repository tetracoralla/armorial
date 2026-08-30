import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogItem } from "../src/core/contracts.js";
import { IconKernel } from "../src/core/kernel.js";
import { Inspector } from "../src/ui/components/Inspector.js";
import type { CatalogData, PickerRuntime } from "../src/ui/runtime.js";

Object.assign(globalThis, { React });

const catalogOutput = new IconKernel().browse({ query: "notification", offset: 0, limit: 1 });
assert.equal(catalogOutput.status, "ok");
if (catalogOutput.status !== "ok") throw new Error("Expected a catalog fixture.");
const catalog = catalogOutput as CatalogData;

function firstCatalogItem(): CatalogItem {
  const item = catalog.items[0];
  if (item === undefined) throw new Error("Expected one catalog item.");
  return item;
}

const selected = firstCatalogItem();

function embeddedRuntime(canAttach: boolean, canContinue: boolean): PickerRuntime {
  return {
    mode: "embedded",
    canAttach,
    canContinue,
    canFullscreen: false,
    initialCatalog: catalog,
    session: null,
    onInitialState: () => () => undefined,
    browse: async () => catalog,
    attach: async () => undefined,
    continueTask: async () => undefined,
    download: async () => undefined,
    requestFullscreen: async () => undefined,
  };
}

function renderInspector(runtime: PickerRuntime): string {
  const noop = async () => undefined;
  return renderToStaticMarkup(React.createElement(Inspector, {
    selected,
    style: { ...catalog.policy },
    context: catalog.context,
    hasOverride: false,
    renderPending: false,
    runtime,
    actionState: "idle",
    onAppearanceChange: () => undefined,
    onAppearanceReset: () => undefined,
    onCopySvg: noop,
    onDownload: noop,
    onCopyForAgent: noop,
    onAttach: noop,
    onContinue: noop,
  }));
}

test("UI source exposes Agent capabilities without account-style connection status", async () => {
  const [toolbar, toolbarButtons, inspector, runtime, styles] = await Promise.all([
    readFile(new URL("../src/ui/components/SearchToolbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/components/ToolbarIconButton.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/components/Inspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/styles.css", import.meta.url), "utf8"),
  ]);
  const visibleSurface = `${toolbar}\n${toolbarButtons}\n${inspector}\n${styles}`;
  assert.doesNotMatch(visibleSurface, /Connected|Unavailable|connection-status|agent-heading/);
  assert.doesNotMatch(runtime, /readonly connected|this\.connected/);
  assert.match(inspector, /runtime\.canAttach \|\| runtime\.canContinue/);
  assert.match(inspector, /runtime\.canAttach &&/);
  assert.match(inspector, /runtime\.canContinue &&/);
  assert.match(inspector, /t\("copyForAgent"\)/);
});

test("standalone keeps product identity while embedded mode controls live in the search row", async () => {
  const [app, header, toolbarButtons, styles] = await Promise.all([
    readFile(new URL("../src/ui/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/components/AppHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/components/ToolbarIconButton.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /runtime\.mode === "standalone" && <AppHeader \/>/);
  assert.match(header, /<strong>Armorial<\/strong>/);
  assert.doesNotMatch(header, /runtime|subtitle|tagline/i);
  assert.match(styles, /\.app-shell\.has-app-header[\s\S]*?\.app-header/);
  assert.match(app, /<SearchToolbar[\s\S]*?actions=\{/);
  assert.match(app, /label=\{figmaCompact \? t\("settings"\) : t\("dragMode"\)\}/);
  assert.match(toolbarButtons, /aria-label=\{label\}/);
  assert.match(toolbarButtons, /@icon-park\/svg\/es\/icons\/Drag\.js/);
  assert.match(toolbarButtons, /@icon-park\/svg\/es\/icons\/Setting\.js/);
  assert.match(toolbarButtons, /@icon-park\/svg\/es\/icons\/FullScreen\.js/);
  assert.doesNotMatch(toolbarButtons, /glyphPaths|<svg|<path/);
  assert.match(styles, /\.search-actions[\s\S]*?\.toolbar-icon-button/);
});

test("embedded inspector keeps supported Agent actions ahead of secondary style detail", () => {
  const markup = renderInspector(embeddedRuntime(true, true));
  const humanActions = markup.indexOf('aria-label="Human export actions"');
  const agentActions = markup.indexOf('aria-label="Agent actions"');
  const styleDetail = markup.indexOf('aria-label="Appearance"');
  assert.ok(humanActions >= 0);
  assert.ok(agentActions > humanActions);
  assert.ok(styleDetail > agentActions);
  assert.match(markup, /Attach to conversation/);
  assert.match(markup, /Select &amp; continue/);

  const fallback = renderInspector(embeddedRuntime(false, false));
  assert.match(fallback, /Copy for Agent/);
  assert.doesNotMatch(fallback, /aria-label="Agent actions"/);
});

test("inspector exposes the editable appearance surface shared with the Agent render parameter", () => {
  const markup = renderInspector(embeddedRuntime(false, false));
  for (const label of ["Theme", "Size", "Stroke", "Linecap", "Linejoin", "Primary", "Secondary", "Inner stroke", "Inner fill", "Reset"]) {
    assert.ok(markup.includes(`>${label}<`), label);
  }
  assert.match(markup, /id="appearance-theme"/);
  assert.match(markup, /id="appearance-size"/);
  assert.match(markup, /id="appearance-stroke-label"/);
  assert.match(markup, /aria-label="Stroke value"/);
  assert.match(markup, /role="radiogroup"/);
  assert.match(markup, /role="radio" aria-checked="true" tabindex="0"[^>]*>4</);
  assert.equal(markup.match(/role="radio" aria-checked="false" tabindex="-1"/g)?.length, 3);
  assert.match(markup, /id="appearance-color-primary"/);
  assert.match(markup, /type="range"/);
  assert.match(markup, /aria-label="Edit Primary color"/);
  assert.match(markup, /aria-controls="appearance-color-editor-primary"/);
  assert.doesNotMatch(markup, /type="color"/);
});
