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
    catalog,
    runtime,
    actionState: "idle",
    onCopySvg: noop,
    onDownload: noop,
    onCopyForAgent: noop,
    onAttach: noop,
    onContinue: noop,
  }));
}

test("UI source exposes Agent capabilities without account-style connection status", async () => {
  const [header, inspector, runtime, styles] = await Promise.all([
    readFile(new URL("../src/ui/components/AppHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/components/Inspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/styles.css", import.meta.url), "utf8"),
  ]);
  const visibleSurface = `${header}\n${inspector}\n${styles}`;
  assert.doesNotMatch(visibleSurface, /Connected|Unavailable|connection-status|agent-heading/);
  assert.doesNotMatch(runtime, /readonly connected|this\.connected/);
  assert.match(inspector, /runtime\.canAttach \|\| runtime\.canContinue/);
  assert.match(inspector, /runtime\.canAttach &&/);
  assert.match(inspector, /runtime\.canContinue &&/);
  assert.match(inspector, /Copy for Agent/);
});

test("embedded inspector keeps supported Agent actions ahead of secondary policy detail", () => {
  const markup = renderInspector(embeddedRuntime(true, true));
  const humanActions = markup.indexOf('aria-label="Human export actions"');
  const agentActions = markup.indexOf('aria-label="Agent actions"');
  const policyDetail = markup.indexOf('class="policy-summary"');
  assert.ok(humanActions >= 0);
  assert.ok(agentActions > humanActions);
  assert.ok(policyDetail > agentActions);
  assert.match(markup, /Attach to conversation/);
  assert.match(markup, /Select &amp; continue/);

  const fallback = renderInspector(embeddedRuntime(false, false));
  assert.match(fallback, /Copy for Agent/);
  assert.doesNotMatch(fallback, /aria-label="Agent actions"/);
});
