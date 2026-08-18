import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { IconKernel } from "../src/core/kernel.js";

const require = createRequire(import.meta.url);

test("kernel construction and search never load the full renderer package", () => {
  const kernel = new IconKernel();
  kernel.search({ query: "settings", limit: 5 });
  assert.equal(require.cache[require.resolve("@icon-park/svg")], undefined);
});

test("renderers load lazily per icon without the package index", () => {
  const kernel = new IconKernel();
  const output = kernel.getIcon({ id: "search" });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.match(output.icon.asset.svg, /<svg/);
  assert.notEqual(require.cache[require.resolve("@icon-park/svg/lib/icons/Search.js")], undefined);
  assert.equal(require.cache[require.resolve("@icon-park/svg")], undefined);
});
