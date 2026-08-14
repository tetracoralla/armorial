import { aliasTargetSlugs, expandAliases, isGenericTaskTerm } from "./aliases.js";
import { COLLECTION_ID, type Candidate } from "./contracts.js";
import { IconKernelError } from "./errors.js";
import { compactText, normalizeText, queryTerms } from "./normalize.js";
import type { IconRecord } from "./provider.js";

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
  category: string;
  categoryCN: string;
};

type PreparedTerm = {
  value: string;
  compact: string;
  order: number;
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
  aliasTargets: readonly PreparedTerm[];
  aliases: readonly PreparedTerm[];
  generic: boolean;
};

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

function buildDocument(record: IconRecord): SearchDocument {
  const name = normalizeText(record.name);
  const nameTokens = name.split(" ");
  const title = normalizeText(record.title);
  const tags = record.tag.map(normalizeText);
  return {
    record,
    name,
    nameCompact: compactText(record.name),
    nameTokens,
    nameTokenSet: new Set(nameTokens),
    title,
    titleCompact: compactText(title),
    tags,
    tagCompacts: tags.map(compactText),
    tagSet: new Set(tags),
    searchableTags: tags.filter((tag) => !isGenericTaskTerm(tag) && tag.length >= 2),
    category: normalizeText(record.category),
    categoryCN: normalizeText(record.categoryCN),
  };
}

function prepareTerms(values: readonly string[]): PreparedTerm[] {
  return values.map((value, order) => ({ value, compact: compactText(value), order }));
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

function buildQueryContext(rawQuery: string): QueryContext {
  const normalized = normalizeText(rawQuery);
  const terms = queryTerms(rawQuery).filter((term) => !isGenericTaskTerm(term));
  const expansion = expandAliases(rawQuery, terms);
  return {
    rawLower: rawQuery.trim().toLocaleLowerCase("en-US"),
    normalized,
    compact: compactText(rawQuery),
    terms,
    termCompacts: new Set(terms.map(compactText)),
    aliasTargets: prepareTerms(expansion.targets),
    aliases: prepareTerms(expansion.aliases),
    generic: isGenericTaskTerm(normalized),
  };
}

function rankDocument(document: SearchDocument, query: QueryContext): Candidate | undefined {
  const exactTags = query.generic
    ? []
    : document.tags.filter(
      (tag, index) => tag === query.normalized || document.tagCompacts[index] === query.compact,
    );

  if (query.rawLower === document.record.canonicalId || query.rawLower === `${COLLECTION_ID}:${document.record.name}`) {
    return makeCandidate(document, 140, "exact_id", [`id:${document.record.canonicalId}`]);
  }
  if (query.rawLower === document.record.name || query.compact === document.nameCompact) {
    return makeCandidate(document, 130, "exact_name", [`name:${document.record.name}`]);
  }
  if (query.termCompacts.has(document.nameCompact)) {
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

  const tokenMatches = query.terms.filter(
    (term) =>
      document.nameTokenSet.has(term) ||
      document.tagSet.has(term) ||
      term === document.title,
  );
  if (tokenMatches.length > 0) {
    const score = 80 + Math.min(10, tokenMatches.length * 2);
    return makeCandidate(document, score, "token", tokenMatches.map((term) => `token:${term}`));
  }

  const containedNameFields: string[] = [];
  if (document.nameCompact.length >= 2 && query.compact.includes(document.nameCompact)) {
    containedNameFields.push(`name:${document.record.name}`);
  }
  if (containedNameFields.length > 0) {
    return makeCandidate(document, 76, "contains", containedNameFields);
  }

  const containedTitleFields: string[] = [];
  if (document.title.length >= 2 && query.normalized.includes(document.title)) {
    containedTitleFields.push(`title:${document.record.title}`);
  }
  if (containedTitleFields.length > 0) {
    return makeCandidate(document, 74, "contains", containedTitleFields);
  }

  const containedTagFields: string[] = [];
  for (const tag of document.searchableTags) {
    if (query.normalized.includes(tag)) {
      containedTagFields.push(`tag:${tag}`);
    }
  }
  if (containedTagFields.length > 0) {
    return makeCandidate(document, 70, "contains", containedTagFields);
  }

  const containingTerms = query.terms.filter(
    (term) =>
      term.length >= 2 &&
      (document.name.includes(term) || document.title.includes(term) || document.tags.some((tag) => tag.includes(term))),
  );
  if (containingTerms.length > 0) {
    return makeCandidate(document, 60, "contains", containingTerms.map((term) => `contains:${term}`));
  }

  const categoryMatches = query.terms.filter((term) => term === document.category || term === document.categoryCN);
  if (categoryMatches.length > 0) {
    return makeCandidate(document, 35, "category", categoryMatches.map((term) => `category:${term}`));
  }

  return undefined;
}

export class IconSearchIndex {
  readonly #documents: readonly SearchDocument[];

  constructor(records: readonly IconRecord[]) {
    const recordSlugs = new Set(records.map((record) => record.name));
    const missingTargets = aliasTargetSlugs().filter((target) => !recordSlugs.has(target));
    if (missingTargets.length > 0) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: `Built-in aliases reference missing IconPark targets: ${missingTargets.join(", ")}.`,
      });
    }
    this.#documents = records.map(buildDocument);
  }

  rank(query: string): Ranked[] {
    const context = buildQueryContext(query);
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
