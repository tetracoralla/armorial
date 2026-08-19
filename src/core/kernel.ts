import { z } from "zod";
import {
  BrowseIconsInputSchema,
  BrowseIconsOutputSchema,
  CandidateSchema,
  DEFAULT_POLICY,
  GetIconInputSchema,
  GetIconOutputSchema,
  GetIconsInputSchema,
  GetIconsOutputSchema,
  IconResultSchema,
  MAX_BATCH_RESPONSE_BYTES,
  MAX_UI_CATALOG_RESPONSE_BYTES,
  ResolveInputSchema,
  ResolveOutputSchema,
  SearchInputSchema,
  SearchOutputSchema,
  type BrowseIconsOutput,
  type Candidate,
  type GetIconInput,
  type GetIconOutput,
  type GetIconsInput,
  type GetIconsOutput,
  type IconPolicy,
  type IconResult,
  type KernelError,
  type RenderStyleOverride,
  type ResolveInput,
  type ResolveOutput,
  type SearchInput,
  type SearchOutput,
} from "./contracts.js";
import { IconKernelError, toKernelError, zodIssuesToKernelError } from "./errors.js";
import {
  findSemanticSelection,
  parseIconPolicy,
  renderStyleEquals,
  resolveEffectivePolicy,
} from "./policy.js";
import { IconParkProvider, type IconRecord } from "./provider.js";
import { IconSearchIndex } from "./search.js";
import { utf8ByteLength } from "./svg.js";

function invalidInput(error: z.ZodError): KernelError {
  return zodIssuesToKernelError("INVALID_INPUT", error, "The icon request is invalid.");
}

function failure(error: KernelError): { status: "error"; error: KernelError } {
  return { status: "error", error };
}

function isSemanticAmbiguity(
  candidates: readonly Candidate[],
  hasMultipleDirectSemanticTargets: boolean,
): boolean {
  const first = candidates[0];
  const second = candidates[1];
  if (first === undefined || second === undefined) return false;
  if (first.matchKind === "exact_id" || first.matchKind === "exact_name") return false;
  return hasMultipleDirectSemanticTargets || first.rankScore - second.rankScore <= 4;
}

function hasAutoResolvableBasis(candidate: Candidate): boolean {
  // Upstream IconPark tags are uncontrolled and can carry unrelated meanings
  // (e.g. 粘贴 also tags the "intersection" icon), so a tag-only match must
  // never decide an icon without a policy selection or explicit choice.
  if (candidate.matchKind === "category" || candidate.matchKind === "exact_tag") return false;
  if (candidate.matchKind !== "contains") return true;
  return candidate.matchedOn.some((match) => match.startsWith("name:") || match.startsWith("title:"));
}

type CatalogCategory = {
  id: string;
  label: string;
  labelCN: string;
  count: number;
};

function buildCategories(records: readonly IconRecord[]): readonly CatalogCategory[] {
  const categoriesById = new Map<string, CatalogCategory>();
  for (const record of records) {
    const current = categoriesById.get(record.category);
    if (current === undefined) {
      categoriesById.set(record.category, {
        id: record.category,
        label: record.category,
        labelCN: record.categoryCN,
        count: 1,
      });
    } else {
      current.count += 1;
    }
  }
  return [...categoriesById.values()].sort((left, right) => left.label.localeCompare(right.label, "en"));
}

export class IconKernel {
  readonly policy: IconPolicy;
  readonly provider: IconParkProvider;
  readonly searchIndex: IconSearchIndex;
  readonly #categories: readonly CatalogCategory[];

  constructor(policyInput: unknown = DEFAULT_POLICY) {
    this.policy = parseIconPolicy(policyInput);
    this.provider = new IconParkProvider();
    this.searchIndex = new IconSearchIndex(this.provider.records);
    this.#categories = buildCategories(this.provider.records);

    for (const [intent, iconId] of Object.entries(this.policy.selections)) {
      if (this.provider.get(iconId) === undefined) {
        throw new IconKernelError({
          code: "INVALID_POLICY",
          message: `Semantic selection "${intent}" references unknown icon "${iconId}".`,
          field: `selections.${intent}`,
        });
      }
    }
  }

  search(input: SearchInput): SearchOutput {
    const parsed = SearchInputSchema.safeParse(input);
    if (!parsed.success) return SearchOutputSchema.parse(failure(invalidInput(parsed.error)));

    try {
      const ranked = this.searchIndex.rank(parsed.data.query);
      const items = ranked.slice(0, parsed.data.limit).map(({ candidate }) => CandidateSchema.parse(candidate));
      return SearchOutputSchema.parse({
        status: "ok",
        kind: "icon_search",
        query: parsed.data.query,
        items,
        truncated: ranked.length > items.length,
      });
    } catch (error) {
      return SearchOutputSchema.parse(failure(toKernelError(error)));
    }
  }

  browse(input: unknown): BrowseIconsOutput {
    const parsed = BrowseIconsInputSchema.safeParse(input);
    if (!parsed.success) return BrowseIconsOutputSchema.parse(failure(invalidInput(parsed.error)));

    try {
      const query = parsed.data.query ?? "";
      const rankedRecords = query.length > 0
        ? this.searchIndex.rank(query)
          .map(({ candidate }) => this.provider.get(candidate.id))
          .filter((record): record is IconRecord => record !== undefined)
        : [...this.provider.records];
      const filtered = parsed.data.category === undefined
        ? rankedRecords
        : rankedRecords.filter((record) => record.category === parsed.data.category);
      const page = filtered.slice(parsed.data.offset, parsed.data.offset + parsed.data.limit);
      const effective = resolveEffectivePolicy(this.policy, parsed.data.context, parsed.data.render);

      const output = {
        status: "ok" as const,
        kind: "icon_catalog" as const,
        query,
        category: parsed.data.category ?? null,
        context: parsed.data.context ?? null,
        offset: parsed.data.offset,
        total: filtered.length,
        truncated: parsed.data.offset + page.length < filtered.length,
        policy: effective.policy,
        categories: this.#categories,
        items: page.map((record) => ({
          ...this.#recordSummary(record),
          asset: this.provider.render(record, effective.policy),
        })),
      };

      if (utf8ByteLength(JSON.stringify(output)) > MAX_UI_CATALOG_RESPONSE_BYTES) {
        return BrowseIconsOutputSchema.parse(failure({
          code: "RESPONSE_TOO_LARGE",
          message: `Catalog response exceeds the ${MAX_UI_CATALOG_RESPONSE_BYTES}-byte limit. Request fewer icons.`,
        }));
      }

      return BrowseIconsOutputSchema.parse(output);
    } catch (error) {
      return BrowseIconsOutputSchema.parse(failure(toKernelError(error)));
    }
  }

  getIcon(input: GetIconInput): GetIconOutput {
    const parsed = GetIconInputSchema.safeParse(input);
    if (!parsed.success) return GetIconOutputSchema.parse(failure(invalidInput(parsed.error)));

    try {
      const icon = this.#renderIcon(parsed.data.id, parsed.data.context, parsed.data.render);
      return GetIconOutputSchema.parse({ status: "ok", kind: "icon", icon });
    } catch (error) {
      return GetIconOutputSchema.parse(failure(toKernelError(error)));
    }
  }

  getIcons(input: GetIconsInput): GetIconsOutput {
    const parsed = GetIconsInputSchema.safeParse(input);
    if (!parsed.success) return GetIconsOutputSchema.parse(failure(invalidInput(parsed.error)));

    try {
      const items = parsed.data.ids.map((id, index) => {
        try {
          return {
            index,
            inputId: id,
            status: "ok" as const,
            icon: this.#renderIcon(id, parsed.data.context, parsed.data.render),
          };
        } catch (error) {
          return {
            index,
            inputId: id,
            status: "error" as const,
            error: toKernelError(error),
          };
        }
      });

      const output = {
        status: "ok" as const,
        kind: "icon_batch" as const,
        items,
        summary: {
          requested: items.length,
          rendered: items.filter((item) => item.status === "ok").length,
          failed: items.filter((item) => item.status === "error").length,
        },
      };

      if (utf8ByteLength(JSON.stringify(output)) > MAX_BATCH_RESPONSE_BYTES) {
        return GetIconsOutputSchema.parse(
          failure({
            code: "RESPONSE_TOO_LARGE",
            message: `Batch response exceeds the ${MAX_BATCH_RESPONSE_BYTES}-byte limit. Request fewer icons.`,
          }),
        );
      }

      return GetIconsOutputSchema.parse(output);
    } catch (error) {
      return GetIconsOutputSchema.parse(failure(toKernelError(error)));
    }
  }

  resolve(input: ResolveInput): ResolveOutput {
    const parsed = ResolveInputSchema.safeParse(input);
    if (!parsed.success) return ResolveOutputSchema.parse(failure(invalidInput(parsed.error)));

    try {
      const selection = findSemanticSelection(this.policy, parsed.data.intent);
      const { ranked, hasMultipleDirectSemanticTargets } = this.searchIndex.rankForResolution(parsed.data.intent);
      const candidates = ranked.slice(0, Math.max(2, parsed.data.alternatives + 1)).map(({ candidate }) => candidate);

      if (selection !== undefined) {
        const icon = this.#renderIcon(selection, parsed.data.context, parsed.data.render);
        return ResolveOutputSchema.parse({
          status: "ok",
          kind: "icon_resolution",
          intent: parsed.data.intent,
          selectionMethod: "policy",
          icon,
          alternatives: candidates.filter((candidate) => candidate.id !== icon.id).slice(0, parsed.data.alternatives),
        });
      }

      const first = candidates[0];
      if (first === undefined || first.rankScore < 50) {
        return ResolveOutputSchema.parse(
          failure({
            code: "ICON_NOT_FOUND",
            message: `No sufficiently specific IconPark match was found for "${parsed.data.intent}".`,
          }),
        );
      }

      if (!hasAutoResolvableBasis(first)) {
        if (candidates.length >= 2) {
          return ResolveOutputSchema.parse({
            status: "ambiguous",
            kind: "icon_resolution",
            intent: parsed.data.intent,
            error: {
              code: "ICON_AMBIGUOUS",
              message: "The closest match rests on an upstream tag or weak containment, so the kernel will not decide it. Choose an id or pin this intent in policy.selections.",
            },
            candidates: candidates.slice(0, Math.max(2, parsed.data.alternatives || 2)),
          });
        }
        return ResolveOutputSchema.parse(
          failure({
            code: "ICON_NOT_FOUND",
            message: `Only upstream tag or weak matches were found for "${parsed.data.intent}". Pin the intent in policy.selections or choose an id via search_icons.`,
          }),
        );
      }

      if (isSemanticAmbiguity(candidates, hasMultipleDirectSemanticTargets)) {
        return ResolveOutputSchema.parse({
          status: "ambiguous",
          kind: "icon_resolution",
          intent: parsed.data.intent,
          error: {
            code: "ICON_AMBIGUOUS",
            message: hasMultipleDirectSemanticTargets
              ? "The intent contains multiple icon semantics. Choose one intent, choose an id, or pin the complete intent in policy.selections."
              : "Multiple icons have the same semantic basis. Choose an id or pin this intent in policy.selections.",
          },
          candidates: candidates.slice(0, Math.max(2, parsed.data.alternatives || 2)),
        });
      }

      const icon = this.#renderIcon(first.id, parsed.data.context, parsed.data.render);
      const selectionMethod = first.matchKind === "exact_id"
        ? "exact_id"
        : first.matchKind === "exact_name"
          ? "exact_name"
          : "ranked";
      return ResolveOutputSchema.parse({
        status: "ok",
        kind: "icon_resolution",
        intent: parsed.data.intent,
        selectionMethod,
        icon,
        alternatives: candidates.slice(1, parsed.data.alternatives + 1),
      });
    } catch (error) {
      return ResolveOutputSchema.parse(failure(toKernelError(error)));
    }
  }

  #renderIcon(inputId: string, context?: string, render?: RenderStyleOverride): IconResult {
    const record = this.provider.get(inputId);
    if (record === undefined) {
      throw new IconKernelError({
        code: "ICON_NOT_FOUND",
        message: `Icon "${inputId}" was not found in the approved IconPark collection.`,
        field: "id",
      });
    }

    const base = resolveEffectivePolicy(this.policy, context);
    const effective = resolveEffectivePolicy(this.policy, context, render);
    const asset = this.provider.render(record, effective.policy);
    return IconResultSchema.parse({
      ...this.#recordSummary(record),
      license: "Apache-2.0",
      policy: effective.policy,
      capabilities: this.provider.capabilities,
      policyCompliance: renderStyleEquals(base.policy, effective.policy) ? "compliant" : "overridden",
      asset,
      warnings: effective.warnings,
    });
  }

  #recordSummary(record: IconRecord) {
    return {
      id: record.canonicalId,
      collection: this.provider.id,
      name: record.name,
      title: record.title,
      category: record.category,
      categoryCN: record.categoryCN,
    };
  }
}
