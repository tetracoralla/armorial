import assert from "node:assert/strict";
import rawSearchSemantics from "../src/core/search-semantics.json" with { type: "json" };
import { IconParkProvider } from "../src/core/provider.js";
import { buildSearchSemanticIndex } from "../src/core/search-semantics.js";

const MAX_ICONS_PER_TERM = 12;
const provider = new IconParkProvider();
const index = buildSearchSemanticIndex(provider.records, rawSearchSemantics);
const ids = [...index.keys()];
assert.deepEqual(ids, [...ids].sort((left, right) => left.localeCompare(right, "en")), "semantic ids must be sorted");

const iconsByTerm = new Map<string, string[]>();
for (const [iconId, terms] of index) {
  assert.deepEqual(
    terms,
    [...terms].sort((left, right) => left.localeCompare(right, "en")),
    `semantic terms for ${iconId} must be sorted`,
  );
  for (const term of terms) {
    const iconIds = iconsByTerm.get(term) ?? [];
    iconIds.push(iconId);
    iconsByTerm.set(term, iconIds);
  }
}

for (const [term, iconIds] of iconsByTerm) {
  assert.ok(
    iconIds.length <= MAX_ICONS_PER_TERM,
    `semantic term "${term}" maps to ${iconIds.length} icons; maximum is ${MAX_ICONS_PER_TERM}`,
  );
}

const termCount = [...index.values()].reduce((sum, terms) => sum + terms.length, 0);
console.log(JSON.stringify({ annotatedIcons: index.size, terms: termCount, uniqueTerms: iconsByTerm.size }));
