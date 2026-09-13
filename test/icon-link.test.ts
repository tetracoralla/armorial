import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_POLICY } from "../src/core/contracts.js";
import { createIconLink, readIconLink } from "../src/ui/icon-link.js";

test("icon links reproduce style and identity without sharing policy names or query strings", () => {
  const style = { ...DEFAULT_POLICY.defaults, size: 32 };
  const url = new URL(createIconLink("https://example.org/armorial/?private=secret", "icon-park:search", style, "a".repeat(64)));
  assert.equal(url.search, "");
  assert.deepEqual(readIconLink(url.hash), { icon: "icon-park:search", render: style, sha256: "a".repeat(64) });
  assert.equal(readIconLink("#help"), null);
});

test("invalid, oversized, duplicate, and executable link input is rejected", () => {
  const good = new URL(createIconLink("https://example.org/", "search", DEFAULT_POLICY.defaults, "a".repeat(64))).hash;
  for (const bad of ["#icon=search", "#icon=" + "x".repeat(3000), good + "&icon=close", good + "&url=https://evil.test",
    good.replace("search", "javascript:evil"), good.replace("%22size%22%3A24", "%22size%22%3A0")]) {
    assert.throws(() => readIconLink(bad), bad);
  }
  assert.throws(() => createIconLink("javascript:alert(1)", "search", DEFAULT_POLICY.defaults, "a".repeat(64)));
});
