import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { compactText, normalizeText } from "../src/core/normalize.js";

// Reference pipeline the ASCII fast path must match exactly. If normalizeText
// is reworked again, this differential over the pinned corpus plus adversarial
// strings is the guard against silent ranking changes.
function referenceNormalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const require = createRequire(import.meta.url);
const icons = require("@icon-park/svg/icons.json") as ReadonlyArray<{
  name: string;
  title: string;
  category: string;
  categoryCN: string;
  tag: readonly string[];
}>;

const corpus = new Set<string>();
for (const icon of icons) {
  corpus.add(icon.name);
  corpus.add(icon.title);
  corpus.add(icon.category);
  corpus.add(icon.categoryCN);
  for (const tag of icon.tag) corpus.add(tag);
}

const adversarial = [
  "",
  " ",
  "   ",
  "a",
  "A",
  "aB",
  "AbC",
  "ABc",
  "1A",
  "A1",
  "a1B2",
  "x_Y",
  "a-b",
  "a--b",
  " -a- ",
  "!!a!!",
  "ab cd",
  "Ab  Cd",
  "aBc9De",
  "Z9z",
  "9zZ",
  "_.-",
  "a\u0000b",
  "tab\tsep",
  "ﬁle",
  "ﬀ",
  "ＡＢＣ",
  "ａｂｃ１",
  "①",
  "Ⅱ",
  "℡",
  "设置 Settings",
  "Ｍｅｎｕ菜单",
  "ÅÄÖ åäö",
  "A­B",
  "ÅB",
  "gaṛden",
  "𝟏𝟐𝟑",
  "ﬅ aB",
  "ñ  Ñ",
];

test("normalizeText matches the reference pipeline over the full icon corpus", () => {
  assert.ok(corpus.size > 2000);
  for (const value of corpus) {
    assert.equal(normalizeText(value), referenceNormalize(value), JSON.stringify(value));
    assert.equal(compactText(value), referenceNormalize(value).replace(/\s+/g, ""), JSON.stringify(value));
  }
});

test("normalizeText matches the reference pipeline on adversarial strings", () => {
  for (const value of adversarial) {
    assert.equal(normalizeText(value), referenceNormalize(value), JSON.stringify(value));
    assert.equal(compactText(value), referenceNormalize(value).replace(/\s+/g, ""), JSON.stringify(value));
  }
});
