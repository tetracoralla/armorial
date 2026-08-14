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
  type BrowseIconsInput,
  type BrowseIconsOutput,
  type Candidate,
  type GetIconInput,
  type GetIconOutput,
  type GetIconsInput,
  type GetIconsOutput,
  type IconPolicy,
  type IconResult,
  type KernelError,
  type ResolveInput,
  type ResolveOutput,
  type SearchInput,
  type SearchOutput,
} from "./contracts.js";
import { IconKernelError, toKernelError } from "./errors.js";
import {
  findSemanticSelection,
  parseIconPolicy,
  resolveEffectivePolicy,
} from "./policy.js";
import { IconParkProvider, type IconRecord } from "./provider.js";
import { IconSearchIndex } from "./search.js";

function invalidInput(error: z.ZodError): KernelError {
  const issue = error.issues[0];
  return {
    code: "INVALID_INPUT",
    message: issue?.message ?? "The icon request is invalid.",
    ...(issue?.path.length ? { field: issue.path.join(".") } : {}),
  };
}

function failure(error: KernelError): { status: "error"; error: KernelError } {
  return { status: "error", error };
}

function isSemanticAmbiguity(candidates: readonly Candidate[]): boolean {
  const first = candidates[0];
  const second = candidates[1];
  if (first === undefined || second === undefined) return false;
  if (first.matchKind === "exact_id" || first.matchKind === "exact_name") return false;
  return first.rankScore - second.rankScore <= 4;
}

function hasAutoResolvableBasis(candidate: Candidate): boolean {
  if (candidate.matchKind === "category") return false;
  if (candidate.matchKind !== "contains") return true;
  return candidate.matchedOn.some((match) => match.startsWith("name:") || match.startsWith("title:"));
}

export class IconKernel {
  readonly policy: IconPolicy;
  readonly provider: IconParkProvider;
  readonly searchIndex: IconSearchIndex;

  constructor(policyInput: unknown = DEFAULT_POLICY) {
    this.policy = parseIconPolicy(policyInput);
    this.provider = new IconParkProvider();
    this.searchIndex = new IconSearchIndex(this.provider.records);

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

    const ranked = this.searchIndex.rank(parsed.data.query);
    const items = ranked.slice(0, parsed.data.limit).map(({ candidate }) => CandidateSchema.parse(candidate));
    return SearchOutputSchema.parse({
      status: "ok",
      kind: "icon_search",
      query: parsed.data.query,
      items,
      truncated: ranked.length > items.length,
    });
  }

  browse(input: BrowseIconsInput): BrowseIconsOutput {
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
      const effective = resolveEffectivePolicy(this.policy, parsed.data.context);
      const categoriesById = new Map<string, { id: string; label: string; labelCN: string; count: number }>();

      for (const record of this.provider.records) {
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
        categories: [...categoriesById.values()].sort((left, right) => left.label.localeCompare(right.label, "en")),
        items: page.map((record) => ({
          ...this.#recordSummary(record),
          asset: this.provider.render(record, effective.policy),
        })),
      };

      if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_UI_CATALOG_RESPONSE_BYTES) {
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
      const icon = this.#renderIcon(parsed.data.id, parsed.data.context);
      return GetIconOutputSchema.parse({ status: "ok", kind: "icon", icon });
    } catch (error) {
      return GetIconOutputSchema.parse(failure(toKernelError(error)));
    }
  }

  getIcons(input: GetIconsInput): GetIconsOutput {
    const parsed = GetIconsInputSchema.safeParse(input);
    if (!parsed.success) return GetIconsOutputSchema.parse(failure(invalidInput(parsed.error)));

    const items = parsed.data.ids.map((id, index) => {
      try {
        return {
          index,
          inputId: id,
          status: "ok" as const,
          icon: this.#renderIcon(id, parsed.data.context),
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

    if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_BATCH_RESPONSE_BYTES) {
      return GetIconsOutputSchema.parse(
        failure({
          code: "RESPONSE_TOO_LARGE",
          message: `Batch response exceeds the ${MAX_BATCH_RESPONSE_BYTES}-byte limit. Request fewer icons.`,
        }),
      );
    }

    return GetIconsOutputSchema.parse(output);
  }

  resolve(input: ResolveInput): ResolveOutput {
    const parsed = ResolveInputSchema.safeParse(input);
    if (!parsed.success) return ResolveOutputSchema.parse(failure(invalidInput(parsed.error)));

    const selection = findSemanticSelection(this.policy, parsed.data.intent);
    const ranked = this.searchIndex.rank(parsed.data.intent);
    const candidates = ranked.slice(0, Math.max(2, parsed.data.alternatives + 1)).map(({ candidate }) => candidate);

    if (selection !== undefined) {
      try {
        const icon = this.#renderIcon(selection, parsed.data.context);
        return ResolveOutputSchema.parse({
          status: "ok",
          kind: "icon_resolution",
          intent: parsed.data.intent,
          selectionMethod: "policy",
          icon,
          alternatives: candidates.filter((candidate) => candidate.id !== icon.id).slice(0, parsed.data.alternatives),
        });
      } catch (error) {
        return ResolveOutputSchema.parse(failure(toKernelError(error)));
      }
    }

    const first = candidates[0];
    if (first === undefined || first.rankScore < 50 || !hasAutoResolvableBasis(first)) {
      return ResolveOutputSchema.parse(
        failure({
          code: "ICON_NOT_FOUND",
          message: `No sufficiently specific IconPark match was found for "${parsed.data.intent}".`,
        }),
      );
    }

    if (isSemanticAmbiguity(candidates)) {
      return ResolveOutputSchema.parse({
        status: "ambiguous",
        kind: "icon_resolution",
        intent: parsed.data.intent,
        error: {
          code: "ICON_AMBIGUOUS",
          message: "Multiple icons have the same semantic basis. Choose an id or pin this intent in policy.selections.",
        },
        candidates: candidates.slice(0, Math.max(2, parsed.data.alternatives || 2)),
      });
    }

    try {
      const icon = this.#renderIcon(first.id, parsed.data.context);
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

  #renderIcon(inputId: string, context?: string): IconResult {
    const record = this.provider.get(inputId);
    if (record === undefined) {
      throw new IconKernelError({
        code: "ICON_NOT_FOUND",
        message: `Icon "${inputId}" was not found in the approved IconPark collection.`,
        field: "id",
      });
    }

    const effective = resolveEffectivePolicy(this.policy, context);
    const asset = this.provider.render(record, effective.policy);
    return IconResultSchema.parse({
      ...this.#recordSummary(record),
      license: "Apache-2.0",
      policy: effective.policy,
      capabilities: this.provider.capabilities,
      policyCompliance: "compliant",
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
