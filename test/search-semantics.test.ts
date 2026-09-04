import assert from "node:assert/strict";
import { test } from "node:test";
import { IconKernel } from "../src/core/kernel.js";
import { buildSearchSemanticIndex } from "../src/core/search-semantics.js";
import { IconSearchIndex } from "../src/core/search.js";

test("internal search semantics are bounded, normalized, non-generic, and provider-backed", () => {
  const records = new IconKernel().provider.records;
  const accepted = buildSearchSemanticIndex(records, {
    "icon-park:rotating-forward": ["clockwise rotation", "turn clockwise"],
  });
  assert.deepEqual(accepted.get("icon-park:rotating-forward"), ["clockwise rotation", "turn clockwise"]);

  for (const [rawSemantics, expected] of [
    [{ "icon-park:missing": ["missing meaning"] }, /unknown icon id/],
    [{ "icon-park:rotating-forward": ["Rotate Direction"] }, /is not normalized/],
    [{ "icon-park:rotating-forward": ["icon"] }, /too generic/],
    [{ "icon-park:rotating-forward": ["rotating forward"] }, /duplicates provider metadata/],
    [{ "icon-park:rotating-forward": ["clockwise rotation", "clockwise rotation"] }, /is duplicated/],
    [{ "icon-park:rotating-forward": ["a", "b"] }, /bounded schema/],
  ] as const) {
    assert.throws(() => buildSearchSemanticIndex(records, rawSemantics), expected);
  }
});

test("semantic phrases improve recall without exposing an internal description field", () => {
  const records = new IconKernel().provider.records;
  const index = new IconSearchIndex(records, {
    "icon-park:rotating-forward": ["clockwise rotation", "turn clockwise"],
    "icon-park:align-right": ["right edge alignment"],
  });

  const exact = index.rank("clockwise rotation");
  assert.equal(exact[0]?.candidate.id, "icon-park:rotating-forward");
  assert.equal(exact[0]?.candidate.matchKind, "alias");
  assert.deepEqual(exact[0]?.candidate.matchedOn, ["semantic:clockwise rotation"]);
  assert.equal("description" in (exact[0]?.candidate ?? {}), false);

  const sentence = index.rank("please turn clockwise in this toolbar");
  assert.equal(sentence[0]?.candidate.id, "icon-park:rotating-forward");
  assert.equal(sentence[0]?.candidate.matchKind, "token");

  const covered = index.rank("align object to the right edge");
  assert.equal(covered[0]?.candidate.id, "icon-park:align-right");
  assert.ok(covered[0]?.candidate.matchedOn.includes("semantic:right edge alignment"));
});

test("shared semantic terms stay tied so the deterministic core does not invent a winner", () => {
  const records = new IconKernel().provider.records;
  const index = new IconSearchIndex(records, {
    "icon-park:bookmark": ["favorite"],
    "icon-park:star": ["favorite"],
  });
  const ranked = index.rank("favorite");
  assert.equal(ranked[0]?.candidate.rankScore, ranked[1]?.candidate.rankScore);
  assert.deepEqual(
    ranked.slice(0, 2).map(({ candidate }) => candidate.id),
    ["icon-park:bookmark", "icon-park:star"],
  );
});

test("reviewed production semantics improve conventional UI searches without hiding ambiguity", () => {
  const kernel = new IconKernel();

  const location = kernel.resolve({ intent: "location", alternatives: 3 });
  assert.equal(location.status, "ok");
  if (location.status === "ok") assert.equal(location.icon.id, "icon-park:local");

  const external = kernel.resolve({ intent: "open in new tab", alternatives: 3 });
  assert.equal(external.status, "ok");
  if (external.status === "ok") assert.equal(external.icon.id, "icon-park:external-transmission");

  const sparkle = kernel.resolve({ intent: "sparkle", alternatives: 0 });
  assert.equal(sparkle.status, "ok");
  if (sparkle.status === "ok") assert.equal(sparkle.icon.id, "icon-park:magic");

  const previous = kernel.resolve({ intent: "previous", alternatives: 3 });
  assert.equal(previous.status, "ambiguous");
  if (previous.status === "ambiguous") {
    assert.deepEqual(previous.candidates.map((candidate) => candidate.id), [
      "icon-park:arrow-left",
      "icon-park:double-left",
      "icon-park:go-start",
    ]);
  }

  const favorite = kernel.search({ query: "favorite", limit: 5 });
  assert.equal(favorite.status, "ok");
  if (favorite.status === "ok") {
    assert.deepEqual(favorite.items.slice(0, 2).map((candidate) => candidate.id), [
      "icon-park:bookmark",
      "icon-park:star",
    ]);
    assert.equal(favorite.items.some((candidate) => "description" in candidate), false);
  }
});
