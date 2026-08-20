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

test("high-frequency UI actions resolve through controlled aliases in both languages", () => {
  const kernel = new IconKernel();
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["paste", "icon-park:clipboard"],
    ["粘贴", "icon-park:clipboard"],
    ["黏贴", "icon-park:clipboard"],
    ["collapse", "icon-park:click-to-fold"],
    ["折叠", "icon-park:click-to-fold"],
    ["收起", "icon-park:click-to-fold"],
    ["visibility", "icon-park:preview-open"],
    ["visible", "icon-park:preview-open"],
    ["可见", "icon-park:preview-open"],
    ["hide", "icon-park:preview-close"],
    ["hidden", "icon-park:preview-close"],
    ["隐藏", "icon-park:preview-close"],
    ["不可见", "icon-park:preview-close"],
  ];
  for (const [intent, iconId] of expected) {
    const output = kernel.resolve({ intent, alternatives: 3 });
    assert.equal(output.status, "ok", intent);
    if (output.status === "ok") assert.equal(output.icon.id, iconId, intent);
  }
});

test("an upstream tag match alone never auto-decides an icon", () => {
  const kernel = new IconKernel();
  // "粘贴" tags the unrelated "intersection" icon upstream; the controlled
  // paste alias must outrank it, and a tag-only winner like "重合" must never
  // become a silent deterministic decision.
  for (const intent of ["重合", "拷贝"]) {
    const output = kernel.resolve({ intent, alternatives: 3 });
    assert.notEqual(output.status, "ok", intent);
    if (output.status === "ambiguous") {
      assert.equal(output.candidates.length >= 2, true, intent);
    }
  }
});

test("generic icon wording preserves a directly requested deletion target", () => {
  const kernel = new IconKernel();
  for (const intent of ["我要删除图标", "删除图标"]) {
    const output = kernel.resolve({ intent, alternatives: 3 });
    assert.equal(output.status, "ok", intent);
    if (output.status === "ok") assert.equal(output.icon.id, "icon-park:delete", intent);
  }

  const compound = kernel.resolve({ intent: "删除通知", alternatives: 3 });
  assert.equal(compound.status, "ambiguous");
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
  assert.equal(renderedStrokeWidth, 3);
  assert.equal(output.icon.capabilities.strokeWidthUnit, "icon-park-grid");
});

test("per-call render override layers over context policy and reports the effective style", () => {
  const policy = policyWith({
    contexts: { toolbar: { size: 20, strokeWidth: 3 } },
  });
  const output = new IconKernel(policy).getIcon({
    id: "search",
    context: "toolbar",
    render: { size: 32, colors: { primary: "#0F172A" } },
  });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.equal(output.icon.policy.size, 32);
  assert.equal(output.icon.policy.strokeWidth, 3);
  assert.equal(output.icon.policy.colors.primary, "#0f172a");
  assert.equal(output.icon.policy.colors.secondary, DEFAULT_POLICY.defaults.colors.secondary);
  assert.equal(output.icon.policy.context, "toolbar");
  assert.equal(output.icon.policyCompliance, "overridden");
  assert.match(output.icon.asset.svg, /width="32"/);

  const unchanged = new IconKernel(policy).getIcon({
    id: "search",
    context: "toolbar",
    render: { size: 20, strokeWidth: 3 },
  });
  assert.equal(unchanged.status, "ok");
  if (unchanged.status === "ok") assert.equal(unchanged.icon.policyCompliance, "compliant");
});

test("render override is deterministic and rejected when it carries invalid values", () => {
  const kernel = new IconKernel();
  const render = { theme: "filled" as const, strokeWidth: 4 };
  const first = kernel.getIcon({ id: "search", render });
  const second = kernel.getIcon({ id: "search", render });
  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  if (first.status !== "ok" || second.status !== "ok") return;
  assert.equal(first.icon.asset.sha256, second.icon.asset.sha256);
  assert.equal(first.icon.policy.theme, "filled");

  for (const invalidRender of [
    { strokeWidth: 0.5 },
    { strokeWidth: 2.5 },
    { strokeWidth: 5 },
    { strokeWidth: 99 },
    { size: 4 },
    { colors: { primary: 'red" onload="alert(1)' } },
    { invented: true },
  ]) {
    const output = kernel.getIcon({ id: "search", render: invalidRender });
    assert.equal(output.status, "error", JSON.stringify(invalidRender));
    if (output.status === "error") assert.equal(output.error.code, "INVALID_INPUT");
  }
});

test("resolve, batch, and browse honor the same per-call render override", () => {
  const kernel = new IconKernel();
  const render = { size: 40, strokeLinecap: "square" as const };

  const resolved = kernel.resolve({ intent: "我要新增图标", alternatives: 2, render });
  assert.equal(resolved.status, "ok");
  if (resolved.status !== "ok") return;
  assert.equal(resolved.icon.id, "icon-park:add");
  assert.equal(resolved.icon.policy.size, 40);
  assert.match(resolved.icon.asset.svg, /width="40"/);

  const batch = kernel.getIcons({ ids: ["search", "setting"], render });
  assert.equal(batch.status, "ok");
  if (batch.status !== "ok") return;
  assert.deepEqual(batch.items.map((item) => item.status === "ok" ? item.icon.policy.strokeLinecap : item.status), ["square", "square"]);

  const browsed = kernel.browse({ query: "notification", offset: 0, limit: 3, render });
  assert.equal(browsed.status, "ok");
  if (browsed.status !== "ok") return;
  assert.equal(browsed.policy.size, 40);
  assert.ok(browsed.items.every((item) => item.asset.svg.includes('width="40"')));
});

test("policy stroke weight stays on the IconPark 1-4 grid at different rendered sizes", () => {
  for (const [size, strokeWidth] of [[24, 4], [20, 4], [20, 3]] as const) {
    const output = new IconKernel(policyWith({
      defaults: { ...DEFAULT_POLICY.defaults, size, strokeWidth },
    })).getIcon({ id: "search" });
    assert.equal(output.status, "ok");
    if (output.status !== "ok") continue;
    const nativeStrokeWidth = Number(output.icon.asset.svg.match(/stroke-width="([^"]+)"/)?.[1]);
    assert.equal(nativeStrokeWidth, strokeWidth, `${size}px icon at IconPark weight ${strokeWidth}`);
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
  const kernel = new IconKernel(policy);

  for (const intent of ["delete settings", "添加删除"]) {
    const output = kernel.resolve({ intent, alternatives: 2 });
    assert.equal(output.status, "ambiguous", intent);
    if (output.status !== "ambiguous") continue;
    assert.equal(output.error.code, "ICON_AMBIGUOUS", intent);
    assert.ok(output.candidates.length >= 2, intent);
  }
});

test("a longer direct Chinese intent is not split into its contained alias", () => {
  const output = new IconKernel().resolve({ intent: "不可见", alternatives: 2 });
  assert.equal(output.status, "ok");
  if (output.status !== "ok") return;
  assert.equal(output.icon.id, "icon-park:preview-close");
  assert.equal(output.alternatives.some((candidate) => candidate.id === "icon-park:preview-open"), false);
});

test("compound Chinese intents through member aliases are never silently decided", () => {
  const kernel = new IconKernel();
  // 上传/下载 enter through members of English-triggered groups, so the
  // compound-intent guard must see them just like the English equivalents.
  const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["上传 下载", ["icon-park:upload", "icon-park:download"]],
    ["删除 上传", ["icon-park:delete", "icon-park:upload"]],
    ["上传图片 下载文件", ["icon-park:upload", "icon-park:download"]],
  ];
  for (const [intent, expectedIds] of cases) {
    const output = kernel.resolve({ intent, alternatives: 3 });
    assert.equal(output.status, "ambiguous", intent);
    if (output.status !== "ambiguous") continue;
    assert.equal(output.error.code, "ICON_AMBIGUOUS", intent);
    const candidateIds = new Set(output.candidates.map((candidate) => candidate.id));
    for (const expectedId of expectedIds) assert.equal(candidateIds.has(expectedId), true, `${intent}: ${expectedId}`);
  }
});

test("single Chinese member semantics still resolve after member-based direct matching", () => {
  const kernel = new IconKernel();
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["上传图片", "icon-park:upload"],
    ["下载文件", "icon-park:download"],
    ["取消", "icon-park:close"],
    ["黏贴", "icon-park:clipboard"],
  ];
  for (const [intent, iconId] of expected) {
    const output = kernel.resolve({ intent, alternatives: 3 });
    assert.equal(output.status, "ok", intent);
    if (output.status === "ok") assert.equal(output.icon.id, iconId, intent);
  }
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
    assert.doesNotMatch(output.icon.asset.svg, /<script\b|<foreignObject\b|\son[a-z]+\s*=|<animate\b|<set\b|@import\b|<image\b/i, record.canonicalId);
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
