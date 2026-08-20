import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import {
  createIconTemplate,
  MAX_PAGES_ICON_CATALOG_BYTES,
  PAGES_ICON_CATALOG_VERSION,
  renderIconTemplate,
  type IconTemplateRenderProps,
  type IconTemplateSourceRenderer,
  type PagesIconCatalog,
} from "../src/ui/pages-icon-catalog.js";

const require = createRequire(import.meta.url);
const projectRoot = resolve(import.meta.dirname, "..");
const pagesRoot = resolve(projectRoot, ".pages-dist");
const catalogPath = resolve(pagesRoot, "assets", "icon-catalog.json");
const packageRoot = dirname(require.resolve("@icon-park/svg/package.json"));
const upstreamMetadata: unknown = require("@icon-park/svg/icons.json");

const source = await readFile(catalogPath, "utf8");
assert.ok(Buffer.byteLength(source) <= MAX_PAGES_ICON_CATALOG_BYTES);
const catalog = JSON.parse(source) as PagesIconCatalog;
assert.equal(catalog.version, PAGES_ICON_CATALOG_VERSION);
assert.deepEqual(catalog.metadata, upstreamMetadata);
assert.ok(Array.isArray(upstreamMetadata));
assert.equal(Object.keys(catalog.templates).length, upstreamMetadata.length);

function normalizeIconIds(svg: string): string {
  return svg.replace(/icon-[-a-f0-9]{1,16}/gi, "icon-00000000");
}

function renderProps(index: number): IconTemplateRenderProps {
  const theme = (["outline", "filled", "two-tone", "multi-color"] as const)[index % 4] ?? "outline";
  const fills = ["#123456", "#789abc", "#def012", "#345678"];
  return {
    theme,
    size: 16 + index % 4 * 8,
    strokeWidth: 1 + index % 4,
    strokeLinecap: (["butt", "round", "square"] as const)[index % 3] ?? "round",
    strokeLinejoin: (["miter", "round", "bevel"] as const)[index % 3] ?? "round",
    fill: theme === "outline" || theme === "filled"
      ? fills[0] ?? "#123456"
      : theme === "two-tone"
        ? fills.slice(0, 2)
        : fills,
  };
}

for (const [index, item] of upstreamMetadata.entries()) {
  assert.ok(typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string");
  const name = (item as { name: string }).name;
  const moduleSlug = name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  const loaded: unknown = require(join(packageRoot, "lib", "icons", `${moduleSlug}.js`));
  const renderer = (loaded as { default?: unknown }).default;
  assert.equal(typeof renderer, "function", name);
  const typedRenderer = renderer as IconTemplateSourceRenderer;
  const template = catalog.templates[name];
  assert.equal(template, createIconTemplate(typedRenderer), `${name}: stored template`);
  const props = renderProps(index);
  assert.equal(
    renderIconTemplate(template, props),
    normalizeIconIds(typedRenderer(props)),
    `${name}: rendered template`,
  );
}

const assetNames = await readdir(resolve(pagesRoot, "assets"));
const javascriptPaths = assetNames
  .filter((name) => extname(name) === ".js")
  .map((name) => resolve(pagesRoot, "assets", name));
const javascriptBytes = (await Promise.all(javascriptPaths.map(async (path) => (await stat(path)).size)))
  .reduce((sum, size) => sum + size, 0);
assert.ok(javascriptBytes <= 1024 * 1024, `Pages JavaScript is ${javascriptBytes} bytes`);

console.log(
  `Pages icon catalog matches ${upstreamMetadata.length} pinned renderers; startup JavaScript is ${javascriptBytes} B.`,
);
