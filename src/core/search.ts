import { aliasTargetSlugs, expandAliases, isGenericTaskTerm } from "./aliases.js";
import { COLLECTION_ID, type Candidate } from "./contracts.js";
import { IconKernelError } from "./errors.js";
import { compactText, normalizeText, queryTerms } from "./normalize.js";
import type { IconRecord } from "./provider.js";
import { buildSearchSemanticIndex } from "./search-semantics.js";

type SearchDocument = {
  record: IconRecord;
  name: string;
  nameCompact: string;
  nameTokens: readonly string[];
  nameTokenSet: ReadonlySet<string>;
  title: string;
  titleCompact: string;
  tags: readonly string[];
  tagCompacts: readonly string[];
  tagSet: ReadonlySet<string>;
  searchableTags: readonly string[];
  semanticTerms: readonly string[];
  semanticTermCompacts: readonly string[];
  semanticTermTokens: readonly ReadonlySet<string>[];
  category: string;
  categoryCN: string;
};

type PreparedTerm = {
  value: string;
  compact: string;
  order: number;
};

type QueryToken = {
  forms: readonly string[];
  specificity: number;
};

type Ranked = {
  candidate: Candidate;
  record: IconRecord;
};

type QueryContext = {
  rawLower: string;
  normalized: string;
  compact: string;
  terms: readonly string[];
  termCompacts: ReadonlySet<string>;
  tokens: readonly QueryToken[];
  aliasTargets: readonly PreparedTerm[];
  aliases: readonly PreparedTerm[];
  hasMultipleDirectSemanticTargets: boolean;
  generic: boolean;
  meaningfulTokenCount: number;
};

type CachedRanking = {
  ranked: Ranked[];
  hasMultipleDirectSemanticTargets: boolean;
};

const MAX_CACHED_QUERIES = 32;
const MAX_CACHED_RANKED_RESULTS = 256;

const KIND_PRIORITY: Readonly<Record<Candidate["matchKind"], number>> = {
  exact_id: 8,
  exact_name: 7,
  exact_title: 6,
  exact_tag: 5,
  alias: 4,
  token: 3,
  contains: 2,
  category: 1,
};

function buildDocument(record: IconRecord, rawSemanticTerms: readonly string[]): SearchDocument {
  // Compact forms derive from the already-normalized text so each field is
  // normalized exactly once per record.
  const name = normalizeText(record.name);
  const nameTokens = name.split(" ");
  const title = normalizeText(record.title);
  const tags = record.tag.map(normalizeText);
  const semanticTerms = rawSemanticTerms.map(normalizeText);
  return {
    record,
    name,
    nameCompact: name.replace(/\s+/g, ""),
    nameTokens,
    nameTokenSet: new Set(nameTokens),
    title,
    titleCompact: title.replace(/\s+/g, ""),
    tags,
    tagCompacts: tags.map((tag) => tag.replace(/\s+/g, "")),
    tagSet: new Set(tags),
    searchableTags: tags.filter((tag) => !isGenericTaskTerm(tag) && tag.length >= 2),
    semanticTerms,
    semanticTermCompacts: semanticTerms.map((term) => term.replace(/\s+/g, "")),
    semanticTermTokens: semanticTerms.map((term) => new Set(term.split(" ").filter(Boolean))),
    category: normalizeText(record.category),
    categoryCN: normalizeText(record.categoryCN),
  };
}

function prepareTerms(values: readonly string[]): PreparedTerm[] {
  return values.map((value, order) => ({ value, compact: compactText(value), order }));
}

function containsHan(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function containsTokenSequence(haystack: string, needle: string): boolean {
  if (containsHan(needle)) return haystack.includes(needle);
  const haystackTokens = haystack.split(" ").filter(Boolean);
  const needleTokens = needle.split(" ").filter(Boolean);
  if (needleTokens.length === 0 || needleTokens.length > haystackTokens.length) return false;
  for (let start = 0; start <= haystackTokens.length - needleTokens.length; start += 1) {
    if (needleTokens.every((token, index) => haystackTokens[start + index] === token)) return true;
  }
  return false;
}

function fieldStartsWithTerm(field: string, term: string): boolean {
  if (containsHan(term)) return field.includes(term);
  const termTokens = term.split(" ").filter(Boolean);
  if (termTokens.length === 0) return false;
  if (termTokens.length > 1) return containsTokenSequence(field, term);
  return field.split(" ").some((token) => token.startsWith(term));
}

function tokenSpecificity(forms: readonly string[], documentFrequency: ReadonlyMap<string, number>): number {
  const frequency = Math.min(...forms.map((form) => documentFrequency.get(form) ?? Number.POSITIVE_INFINITY));
  if (frequency <= 8) return 3;
  if (frequency <= 24) return 2;
  if (frequency <= 64) return 1;
  return 0;
}

function prepareQueryTokens(
  tokens: readonly string[],
  documentFrequency: ReadonlyMap<string, number>,
): QueryToken[] {
  return tokens.map((token) => ({
    forms: queryTerms(token).filter((term) => !isGenericTaskTerm(term)),
  })).map((token) => ({
    ...token,
    specificity: tokenSpecificity(token.forms, documentFrequency),
  }));
}

function makeCandidate(
  document: SearchDocument,
  rankScore: number,
  matchKind: Candidate["matchKind"],
  matchedOn: Iterable<string>,
): Candidate {
  const { record } = document;
  return {
    id: record.canonicalId,
    collection: COLLECTION_ID,
    name: record.name,
    title: record.title,
    category: record.category,
    categoryCN: record.categoryCN,
    rankScore,
    matchKind,
    matchedOn: [...new Set(matchedOn)].slice(0, 8),
  };
}

function buildQueryContext(
  rawQuery: string,
  documentFrequency: ReadonlyMap<string, number>,
): QueryContext {
  const normalized = normalizeText(rawQuery);
  const meaningfulTokens = normalized
    .split(" ")
    .filter((token) => token.length > 0 && !isGenericTaskTerm(token));
  const terms = queryTerms(rawQuery).filter((term) => !isGenericTaskTerm(term));
  const expansion = expandAliases(rawQuery, terms);
  return {
    rawLower: rawQuery.trim().toLocaleLowerCase("en-US"),
    normalized,
    compact: compactText(rawQuery),
    terms,
    termCompacts: new Set(terms.map(compactText)),
    tokens: prepareQueryTokens(meaningfulTokens, documentFrequency),
    aliasTargets: prepareTerms(expansion.targets),
    aliases: prepareTerms(expansion.aliases),
    hasMultipleDirectSemanticTargets: expansion.independentDirectTargetCount > 1,
    generic: isGenericTaskTerm(normalized),
    meaningfulTokenCount: meaningfulTokens.length,
  };
}

function rankDocument(document: SearchDocument, query: QueryContext): Candidate | undefined {
  const exactTags = query.generic
    ? []
    : document.tags.filter(
      (tag, index) => tag === query.normalized || document.tagCompacts[index] === query.compact,
    );
  const exactSemantics = query.generic
    ? []
    : document.semanticTerms.filter(
      (term, index) => term === query.normalized || document.semanticTermCompacts[index] === query.compact,
    );

  if (query.rawLower === document.record.canonicalId) {
    return makeCandidate(document, 140, "exact_id", [`id:${document.record.canonicalId}`]);
  }
  if (query.rawLower === document.record.name || query.compact === document.nameCompact) {
    return makeCandidate(document, 130, "exact_name", [`name:${document.record.name}`]);
  }
  if (query.meaningfulTokenCount === 1 && query.termCompacts.has(document.nameCompact)) {
    return makeCandidate(document, 125, "exact_name", [`name:${document.record.name}`]);
  }
  if (query.normalized === document.title || query.compact === document.titleCompact) {
    return makeCandidate(document, 120, "exact_title", [`title:${document.record.title}`]);
  }
  const aliasTarget = query.aliasTargets.find(
    (target) => target.value === document.name || target.compact === document.nameCompact,
  );
  if (aliasTarget !== undefined) {
    return makeCandidate(
      document,
      119 - Math.min(aliasTarget.order * 5, 8),
      "alias",
      [`alias-target:${aliasTarget.value}`],
    );
  }

  if (exactSemantics.length > 0) {
    return makeCandidate(
      document,
      113,
      "alias",
      exactSemantics.map((term) => `semantic:${term}`),
    );
  }

  if (exactTags.length > 0) {
    return makeCandidate(document, 110, "exact_tag", exactTags.map((tag) => `tag:${tag}`));
  }

  const aliasName = query.aliases.find(
    (alias) => alias.value === document.name || alias.compact === document.nameCompact,
  );
  if (aliasName !== undefined) {
    return makeCandidate(document, 90, "alias", [`alias:${aliasName.value}`]);
  }
  const aliasTitle = query.aliases.find((alias) => alias.value === document.title);
  if (aliasTitle !== undefined) {
    return makeCandidate(document, 85, "alias", [`alias:${aliasTitle.value}`]);
  }
  const aliasTag = query.aliases.find((alias) => document.tagSet.has(alias.value));
  if (aliasTag !== undefined) {
    return makeCandidate(document, 80, "alias", [`alias:${aliasTag.value}`]);
  }

  // Chinese queries do not reliably carry word separators, so a reviewed
  // multi-character semantic may match inside an ordinary sentence. English
  // phrases stay in the token-coverage path below; treating every contained
  // phrase as exact would let an annotation outrank a real icon name.
  const containedSemantics = document.semanticTerms.filter(
    (term) => containsHan(term) && query.compact.includes(compactText(term)),
  );
  if (containedSemantics.length > 0) {
    return makeCandidate(
      document,
      96,
      "alias",
      containedSemantics.map((term) => `semantic:${term}`),
    );
  }

  const tokenMatches = query.tokens.flatMap((token) => {
    const term = token.forms.find(
      (form) =>
        form.length >= 3 &&
        (document.nameTokenSet.has(form) ||
          document.tagSet.has(form) ||
          form === document.title),
    );
    return term === undefined ? [] : [{ term, specificity: token.specificity }];
  });
  const semanticTokenMatches = document.semanticTerms.flatMap((term, index) => {
    const semanticTokens = document.semanticTermTokens[index];
    if (semanticTokens === undefined || semanticTokens.size === 0 || containsHan(term)) return [];
    const matchedQueryTokens = query.tokens.flatMap((token) => {
      const match = token.forms.find((form) => form.length >= 3 && semanticTokens.has(form));
      return match === undefined ? [] : [{ term: match, specificity: token.specificity }];
    });
    const requiredCoverage = semanticTokens.size === 1 ? 1 : 2;
    return new Set(matchedQueryTokens.map((match) => match.term)).size >= requiredCoverage
      ? [{ term, matchedQueryTokens }]
      : [];
  });
  const semanticQueryTokens = semanticTokenMatches.flatMap((match) => match.matchedQueryTokens);
  const matchesByTerm = new Map<string, number>();
  for (const match of [...tokenMatches, ...semanticQueryTokens]) {
    matchesByTerm.set(match.term, Math.max(matchesByTerm.get(match.term) ?? 0, match.specificity));
  }
  const allTokenMatches = [...matchesByTerm];
  if (allTokenMatches.length > 0) {
    const wholeNameToken = tokenMatches.find(
      (match) => match.term === document.name || compactText(match.term) === document.nameCompact,
    );
    const specificity = Math.max(...allTokenMatches.map(([, value]) => value));
    const score = 80
      + Math.min(8, allTokenMatches.length * 4)
      + (wholeNameToken === undefined ? 0 : 2)
      + specificity;
    return makeCandidate(
      document,
      score,
      "token",
      [
        ...(wholeNameToken === undefined ? [] : [`name:${document.record.name}`]),
        ...tokenMatches.map((match) => `token:${match.term}`),
        ...semanticTokenMatches.map((match) => `semantic:${match.term}`),
      ],
    );
  }

  const containedNameFields: string[] = [];
  if (document.nameCompact.length >= 3 && containsTokenSequence(query.normalized, document.name)) {
    containedNameFields.push(`name:${document.record.name}`);
  }
  if (containedNameFields.length > 0) {
    return makeCandidate(document, 76, "contains", containedNameFields);
  }

  const containedTitleFields: string[] = [];
  if (document.title.length >= 2 && containsTokenSequence(query.normalized, document.title)) {
    containedTitleFields.push(`title:${document.record.title}`);
  }
  if (containedTitleFields.length > 0) {
    return makeCandidate(document, 74, "contains", containedTitleFields);
  }

  const containedTagFields: string[] = [];
  for (const tag of document.searchableTags) {
    if (containsTokenSequence(query.normalized, tag)) {
      containedTagFields.push(`tag:${tag}`);
    }
  }
  if (containedTagFields.length > 0) {
    return makeCandidate(document, 70, "contains", containedTagFields);
  }

  const containingTerms = query.tokens.flatMap((token) => {
    const term = token.forms.find(
      (form) =>
        form.length >= 2 &&
        (fieldStartsWithTerm(document.name, form) ||
          fieldStartsWithTerm(document.title, form) ||
          document.tags.some((tag) => fieldStartsWithTerm(tag, form))),
    );
    return term === undefined ? [] : [term];
  });
  if (containingTerms.length > 0) {
    const score = 60 + Math.min(8, containingTerms.length * 2);
    return makeCandidate(document, score, "contains", containingTerms.map((term) => `contains:${term}`));
  }

  const categoryMatches = query.terms.filter((term) => term === document.category || term === document.categoryCN);
  if (categoryMatches.length > 0) {
    return makeCandidate(document, 35, "category", categoryMatches.map((term) => `category:${term}`));
  }

  return undefined;
}

export class IconSearchIndex {
  readonly #documents: readonly SearchDocument[];
  readonly #documentFrequency: ReadonlyMap<string, number>;
  readonly #rankingCache = new Map<string, CachedRanking>();

  constructor(records: readonly IconRecord[], rawSemantics?: unknown) {
    const recordSlugs = new Set(records.map((record) => record.name));
    const missingTargets = aliasTargetSlugs().filter((target) => !recordSlugs.has(target));
    if (missingTargets.length > 0) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: `Built-in aliases reference missing IconPark targets: ${missingTargets.join(", ")}.`,
      });
    }
    const semanticIndex = buildSearchSemanticIndex(records, rawSemantics);
    this.#documents = records.map((record) => buildDocument(record, semanticIndex.get(record.canonicalId) ?? []));
    const documentFrequency = new Map<string, number>();
    for (const document of this.#documents) {
      const terms = new Set([
        ...document.nameTokens,
        ...document.tags.flatMap((tag) => tag.split(" ")),
        ...document.semanticTerms.flatMap((term) => term.split(" ")),
      ]);
      for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    this.#documentFrequency = documentFrequency;
  }

  rank(query: string): Ranked[] {
    return this.#ranking(query).ranked;
  }

  rankForResolution(query: string): {
    ranked: Ranked[];
    hasMultipleDirectSemanticTargets: boolean;
  } {
    return this.#ranking(query);
  }

  #ranking(query: string): CachedRanking {
    const cached = this.#rankingCache.get(query);
    if (cached !== undefined) {
      // Refresh insertion order so repeated UI restyles keep their active
      // query while old one-off searches leave the bounded cache first.
      this.#rankingCache.delete(query);
      this.#rankingCache.set(query, cached);
      return cached;
    }

    const context = buildQueryContext(query, this.#documentFrequency);
    const result = {
      ranked: this.#rank(context),
      hasMultipleDirectSemanticTargets: context.hasMultipleDirectSemanticTargets,
    };
    if (result.ranked.length <= MAX_CACHED_RANKED_RESULTS) {
      this.#rankingCache.set(query, result);
      if (this.#rankingCache.size > MAX_CACHED_QUERIES) {
        const oldest = this.#rankingCache.keys().next().value;
        if (oldest !== undefined) this.#rankingCache.delete(oldest);
      }
    }
    return result;
  }

  #rank(context: QueryContext): Ranked[] {
    const ranked: Ranked[] = [];
    for (const document of this.#documents) {
      const candidate = rankDocument(document, context);
      if (candidate !== undefined) ranked.push({ candidate, record: document.record });
    }

    ranked.sort((left, right) => {
      const score = right.candidate.rankScore - left.candidate.rankScore;
      if (score !== 0) return score;
      const kind = KIND_PRIORITY[right.candidate.matchKind] - KIND_PRIORITY[left.candidate.matchKind];
      if (kind !== 0) return kind;
      return left.record.name.localeCompare(right.record.name, "en");
    });
    return ranked;
  }
}
