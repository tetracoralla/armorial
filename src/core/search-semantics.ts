import { z } from "zod";
import rawSearchSemantics from "./search-semantics.json" with { type: "json" };
import { isGenericTaskTerm } from "./aliases.js";
import { IconKernelError } from "./errors.js";
import { compactText, normalizeText } from "./normalize.js";
import type { IconRecord } from "./provider-shared.js";

const MAX_SEMANTIC_TERMS_PER_ICON = 6;
const MAX_SEMANTIC_TERM_LENGTH = 40;
const MAX_SEMANTIC_INDEX_BYTES = 192 * 1024;

const SearchSemanticTermsSchema = z.record(
  z.string(),
  z.array(z.string().min(2).max(MAX_SEMANTIC_TERM_LENGTH)).min(1).max(MAX_SEMANTIC_TERMS_PER_ICON),
);

export type SearchSemanticIndex = ReadonlyMap<string, readonly string[]>;

function invalidSemantics(message: string): IconKernelError {
  // Corrupt built-in data is a programmer-facing startup invariant, not a
  // domain render failure; report it as internal so it is not mistaken for a
  // user-fixable icon request problem.
  return new IconKernelError({
    code: "INTERNAL_ERROR",
    message: `The built-in search semantics are invalid: ${message}`,
  });
}

export function buildSearchSemanticIndex(
  records: readonly IconRecord[],
  rawSemantics: unknown = rawSearchSemantics,
): SearchSemanticIndex {
  const parsed = SearchSemanticTermsSchema.safeParse(rawSemantics);
  if (!parsed.success) throw invalidSemantics("the data does not match its bounded schema.");
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > MAX_SEMANTIC_INDEX_BYTES) {
    throw invalidSemantics(`the encoded index exceeds ${MAX_SEMANTIC_INDEX_BYTES} bytes.`);
  }

  const recordsById = new Map(records.map((record) => [record.canonicalId, record]));
  const result = new Map<string, readonly string[]>();
  for (const [iconId, rawTerms] of Object.entries(parsed.data)) {
    const record = recordsById.get(iconId);
    if (record === undefined) throw invalidSemantics(`unknown icon id "${iconId}".`);

    const existingTerms = new Set([
      record.name,
      record.title,
      record.category,
      record.categoryCN,
      ...record.tag,
    ].map(normalizeText));
    const normalizedTerms: string[] = [];
    const seen = new Set<string>();
    for (const rawTerm of rawTerms) {
      const term = normalizeText(rawTerm);
      if (term !== rawTerm) {
        throw invalidSemantics(`term "${rawTerm}" for "${iconId}" is not normalized.`);
      }
      if (compactText(term).length < 2 || isGenericTaskTerm(term)) {
        throw invalidSemantics(`term "${term}" for "${iconId}" is too generic.`);
      }
      if (existingTerms.has(term)) {
        throw invalidSemantics(`term "${term}" for "${iconId}" duplicates provider metadata.`);
      }
      if (seen.has(term)) throw invalidSemantics(`term "${term}" is duplicated for "${iconId}".`);
      seen.add(term);
      normalizedTerms.push(term);
    }
    result.set(iconId, normalizedTerms);
  }
  return result;
}
