import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_POLICY,
  MAX_BATCH_SIZE,
  MAX_QUERY_LENGTH,
  MAX_UI_CATALOG_ITEMS,
  MAX_UI_CATALOG_RESPONSE_BYTES,
  type IconPolicy,
} from "../src/core/contracts.js";
import { IconKernelError } from "../src/core/errors.js";
import { IconKernel } from "../src/core/kernel.js";
import { IconSearchIndex } from "../src/core/search.js";

function policyWith(overrides: Partial<IconPolicy>): IconPolicy {
  return {
    ...structuredClone(DEFAULT_POLICY),
    ...overrides,
  };
}

test("loads every pinned IconPark metadata entry and renderer", () => {
  const kernel = new IconKernel();
  assert.equal(kernel.provider.records.length, 2658);
  assert.equal(new Set(kernel.provider.records.map((record) => record.name)).size, 2658);
});

test("search ranks an English plural as the exact singular icon name", () => {
  const output = new IconKernel().search({ query: "settings", limit: 5 });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.equal(output.items[0]?.id, "icon-park:setting");
  assert.equal(output.items[0]?.matchKind, "exact_name");
});

test("search handles Simplified Chinese wording inside an ordinary phrase", () => {
  const output = new IconKernel().search({ query: "我要一个搜索图标", limit: 5 });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.equal(output.items[0]?.id, "icon-park:search");
});

test("human catalog browsing reuses ranked search, policy rendering, and stable paging", () => {
  const kernel = new IconKernel();
  const firstPage = kernel.browse({ query: "notification", offset: 0, limit: 8 });
  assert.equal(firstPage.status, "ok");
  if (firstPage.status !== "ok") return;
  assert.equal(firstPage.items[0]?.id, "icon-park:remind");
  assert.equal(firstPage.policy.strokeWidth, DEFAULT_POLICY.defaults.strokeWidth);
  assert.equal(firstPage.items[0]?.asset.svg.includes("<svg"), true);
  assert.equal(firstPage.categories.reduce((sum, category) => sum + category.count, 0), 2658);

  const secondPage = kernel.browse({ query: "notification", offset: 8, limit: 8 });
  assert.equal(secondPage.status, "ok");
  if (secondPage.status !== "ok") return;
  assert.equal(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size, 16);
});

test("human catalog remains bounded and rejects adapter-shaped extra fields", () => {
  const kernel = new IconKernel();
  const output = kernel.browse({ query: "", offset: 0, limit: MAX_UI_CATALOG_ITEMS });
  assert.equal(output.status, "ok");
  assert.ok(Buffer.byteLength(JSON.stringify(output), "utf8") <= MAX_UI_CATALOG_RESPONSE_BYTES);
  if (output.status === "ok") assert.equal(output.items.length, MAX_UI_CATALOG_ITEMS);

  const invalid = kernel.browse({ query: "search", offset: 0, limit: 8, sourcePath: "/tmp/icon.svg" } as never);
  assert.equal(invalid.status, "error");
  if (invalid.status === "error") assert.equal(invalid.error.code, "INVALID_INPUT");
});

test("direct project aliases use real IconPark targets ahead of broad upstream tags", () => {
  const kernel = new IconKernel();
  for (const [query, expected] of [
    ["通知", "icon-park:remind"],
    ["notification", "icon-park:remind"],
    ["菜单", "icon-park:hamburger"],
    ["menu", "icon-park:hamburger"],
  ] as const) {
    const output = kernel.search({ query, limit: 8 });
    assert.equal(output.status, "ok", query);
    if (output.status !== "ok") continue;
    assert.equal(output.items[0]?.id, expected, query);
    assert.match(output.items[0]?.matchedOn[0] ?? "", /^alias-target:/, query);
  }
});

test("search index refuses to start when built-in alias targets are unavailable", () => {
  assert.throws(
    () => new IconSearchIndex([]),
    /Built-in aliases reference missing IconPark targets/,
  );
});

test("resolve ignores generic icon wording and uses aliases in either direction", () => {
  const kernel = new IconKernel();

  const phrase = kernel.resolve({ intent: "我要新增图标", alternatives: 3 });
  assert.equal(phrase.status, "ok");
  if (phrase.status === "ok") assert.equal(phrase.icon.id, "icon-park:add");

  const chineseAlias = kernel.resolve({ intent: "新增", alternatives: 3 });
  assert.equal(chineseAlias.status, "ok");
  if (chineseAlias.status === "ok") assert.equal(chineseAlias.icon.id, "icon-park:add");

  const englishAlias = kernel.resolve({ intent: "preference", alternatives: 3 });
  assert.equal(englishAlias.status, "ok");
  if (englishAlias.status === "ok") assert.equal(englishAlias.icon.id, "icon-park:setting");
});

test("resolve never auto-selects from generic icon words alone", () => {
  const output = new IconKernel().resolve({ intent: "我要一个图标", alternatives: 3 });
  assert.equal(output.status, "error");
  if (output.status === "error") assert.equal(output.error.code, "ICON_NOT_FOUND");
});

test("overlapping deletion aliases preserve the directly requested semantic target", () => {
  const kernel = new IconKernel();
  for (const intent of ["我要删除图标", "删除图标", "删除通知"]) {
    const output = kernel.resolve({ intent, alternatives: 3 });
    assert.equal(output.status, "ok", intent);
    if (output.status === "ok") assert.equal(output.icon.id, "icon-park:delete", intent);
  }
});

test("resolve reports tied semantic choices instead of inventing SVG", () => {
  const output = new IconKernel().resolve({ intent: "设置", alternatives: 3 });
  assert.equal(output.status, "ambiguous");
  if (output.status !== "ambiguous") return;
  assert.equal(output.candidates.length, 3);
  assert.equal(output.candidates[0]?.rankScore, output.candidates[1]?.rankScore);
  assert.equal("svg" in output, false);
});

test("policy selection resolves one call and applies context style", () => {
  const policy = policyWith({
    contexts: { toolbar: { size: 20, strokeWidth: 3 } },
    selections: { 设置: "icon-park:setting-two" },
  });
  const output = new IconKernel(policy).resolve({ intent: "设置", context: "toolbar", alternatives: 2 });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.equal(output.selectionMethod, "policy");
  assert.equal(output.icon.id, "icon-park:setting-two");
  assert.equal(output.icon.policy.size, 20);
  assert.equal(output.icon.policy.strokeWidth, 3);
  assert.match(output.icon.asset.svg, /width="20"/);
  const renderedStrokeWidth = Number(output.icon.asset.svg.match(/stroke-width="([^"]+)"/)?.[1]);
  const [, , viewBoxWidth, viewBoxHeight] = output.icon.asset.viewBox.split(/\s+/).map(Number);
  assert.equal(renderedStrokeWidth * output.icon.policy.size / Math.max(Number(viewBoxWidth), Number(viewBoxHeight)), 3);
  assert.equal(output.icon.capabilities.strokeWidthUnit, "rendered-px");
});

test("policy stroke width is the final visible width at different rendered sizes", () => {
  for (const [size, strokeWidth] of [[24, 2], [20, 2], [20, 3]] as const) {
    const output = new IconKernel(policyWith({
      defaults: { ...DEFAULT_POLICY.defaults, size, strokeWidth },
    })).getIcon({ id: "search" });
    assert.equal(output.status, "ok");
    if (output.status !== "ok") continue;
    const nativeStrokeWidth = Number(output.icon.asset.svg.match(/stroke-width="([^"]+)"/)?.[1]);
    const [, , viewBoxWidth, viewBoxHeight] = output.icon.asset.viewBox.split(/\s+/).map(Number);
    const visibleStrokeWidth = nativeStrokeWidth * size / Math.max(Number(viewBoxWidth), Number(viewBoxHeight));
    assert.equal(visibleStrokeWidth, strokeWidth, `${size}px icon at ${strokeWidth}px stroke`);
    assert.equal(output.icon.policy.strokeWidth, strokeWidth);
  }
});

test("policy selection survives ordinary English and Chinese icon wording", () => {
  const policy = policyWith({
    selections: {
      settings: "icon-park:setting-two",
      设置: "icon-park:setting-two",
    },
  });
  const kernel = new IconKernel(policy);

  for (const intent of ["settings icon", "我要一个设置图标"]) {
    const output = kernel.resolve({ intent, alternatives: 2 });
    assert.equal(output.status, "ok", intent);
    if (output.status !== "ok") continue;
    assert.equal(output.selectionMethod, "policy", intent);
    assert.equal(output.icon.id, "icon-park:setting-two", intent);
  }
});

test("policy selection does not swallow a multi-semantic intent", () => {
  const policy = policyWith({ selections: { settings: "icon-park:setting-two" } });
  const output = new IconKernel(policy).resolve({ intent: "delete settings", alternatives: 2 });
  assert.notEqual(output.status === "ok" ? output.selectionMethod : undefined, "policy");
});

test("unknown context falls back visibly to default policy", () => {
  const output = new IconKernel().getIcon({ id: "search", context: "unconfigured" });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.equal(output.icon.policy.context, "unconfigured");
  assert.deepEqual(output.icon.warnings.map((warning) => warning.code), ["CONTEXT_NOT_CONFIGURED"]);
});

test("inherited object property names are not treated as configured contexts", () => {
  const output = new IconKernel().getIcon({ id: "search", context: "toString" });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.deepEqual(output.icon.warnings.map((warning) => warning.code), ["CONTEXT_NOT_CONFIGURED"]);
});

test("rendering is byte-for-byte deterministic for icons with internal ids", () => {
  const kernel = new IconKernel();
  const first = kernel.getIcon({ id: "empty" });
  const second = kernel.getIcon({ id: "empty" });
  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  if (first.status !== "ok" || second.status !== "ok") return;
  assert.equal(first.icon.asset.svg, second.icon.asset.svg);
  assert.equal(first.icon.asset.sha256, second.icon.asset.sha256);
  assert.match(first.icon.asset.svg, /icon-svg-select-empty-[a-f0-9]{12}/);
  assert.doesNotMatch(first.icon.asset.svg, /icon-[a-f0-9]{1,8}(?![a-z0-9-])/i);
});

test("all pinned icons render within the safety and response boundary", () => {
  const kernel = new IconKernel();
  for (const record of kernel.provider.records) {
    const output = kernel.getIcon({ id: record.canonicalId });
    assert.equal(output.status, "ok", record.canonicalId);
    if (output.status !== "ok") continue;
    assert.ok(output.icon.asset.bytes > 0, record.canonicalId);
    assert.doesNotMatch(output.icon.asset.svg, /<script\b|<foreignObject\b|\son[a-z]+\s*=/i, record.canonicalId);
  }
});

test("batch preserves input order and reports per-item failure", () => {
  const output = new IconKernel().getIcons({ ids: ["search", "not-a-real-icon", "setting"] });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.deepEqual(output.items.map((item) => item.inputId), ["search", "not-a-real-icon", "setting"]);
  assert.deepEqual(output.items.map((item) => item.status), ["ok", "error", "ok"]);
  assert.deepEqual(output.summary, { requested: 3, rendered: 2, failed: 1 });
});

test("invalid and oversized requests fail before rendering", () => {
  const kernel = new IconKernel();
  const longQuery = kernel.search({ query: "x".repeat(MAX_QUERY_LENGTH + 1), limit: 8 });
  assert.equal(longQuery.status, "error");
  if (longQuery.status === "error") assert.equal(longQuery.error.code, "INVALID_INPUT");

  const largeBatch = kernel.getIcons({ ids: Array.from({ length: MAX_BATCH_SIZE + 1 }, () => "search") });
  assert.equal(largeBatch.status, "error");
  if (largeBatch.status === "error") assert.equal(largeBatch.error.code, "INVALID_INPUT");
});

test("policy rejects SVG-breaking colors, unknown fields, normalized duplicates, and missing icons", () => {
  assert.throws(
    () => new IconKernel(policyWith({
      defaults: {
        ...DEFAULT_POLICY.defaults,
        colors: { ...DEFAULT_POLICY.defaults.colors, primary: 'red" onload="alert(1)' },
      },
    })),
    IconKernelError,
  );

  assert.throws(
    () => new IconKernel({ ...structuredClone(DEFAULT_POLICY), inventedField: true }),
    IconKernelError,
  );

  assert.throws(
    () => new IconKernel(policyWith({
      selections: {
        Settings: "setting",
        settings: "setting-two",
      },
    })),
    /normalize to the same intent/,
  );

  assert.throws(
    () => new IconKernel(policyWith({ selections: { "---": "setting" } })),
    /no searchable letters or numbers/,
  );

  assert.throws(
    () => new IconKernel(policyWith({ selections: { missing: "icon-park:not-a-real-icon" } })),
    /unknown icon/,
  );
});

test("policy accepts supported SVG colors and rejects malformed or unknown colors", () => {
  for (const primary of [
    "#abc",
    "#abcd",
    "#abcdef",
    "#abcdef12",
    "rebeccapurple",
    "currentColor",
    "none",
    "transparent",
    "var(--icon-color)",
  ]) {
    assert.doesNotThrow(() => new IconKernel(policyWith({
      defaults: {
        ...DEFAULT_POLICY.defaults,
        colors: { ...DEFAULT_POLICY.defaults.colors, primary },
      },
    })), primary);
  }

  for (const primary of ["#12345", "#1234567", "notacolor", "currenColor"]) {
    assert.throws(() => new IconKernel(policyWith({
      defaults: {
        ...DEFAULT_POLICY.defaults,
        colors: { ...DEFAULT_POLICY.defaults.colors, primary },
      },
    })), IconKernelError, primary);
  }
});

test("policy accepts case-insensitive CSS keywords and emits canonical colors", () => {
  const expected = new Map([
    ["Red", "red"],
    ["RED", "red"],
    ["RebeccaPurple", "rebeccapurple"],
    ["CURRENTCOLOR", "currentColor"],
  ]);

  for (const [primary, canonical] of expected) {
    const output = new IconKernel(policyWith({
      defaults: {
        ...DEFAULT_POLICY.defaults,
        colors: { ...DEFAULT_POLICY.defaults.colors, primary },
      },
    })).getIcon({ id: "search" });
    assert.equal(output.status, "ok", primary);
    if (output.status === "ok") assert.equal(output.icon.policy.colors.primary, canonical, primary);
  }
});
