import { expandAliases, isGenericTaskTerm } from "./aliases.js";
import {
  COLLECTION_ID,
  IconPolicySchema,
  type IconPolicy,
  type RenderStyle,
  type RenderStyleOverride,
} from "./contracts.js";
import { IconKernelError, zodIssuesToKernelError } from "./errors.js";
import { normalizeText, queryTerms } from "./normalize.js";

export type PolicyWarning = {
  code: "CONTEXT_NOT_CONFIGURED";
  message: string;
};

export type EffectivePolicy = RenderStyle & {
  context: string | null;
};

function semanticTerms(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((term) => term.length > 0 && !isGenericTaskTerm(term));
}

function semanticTargets(value: string): readonly string[] {
  const terms = queryTerms(value).filter((term) => !isGenericTaskTerm(term));
  return expandAliases(value, terms).targets;
}

function hasSameTerms(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((term, index) => term === right[index]);
}

function canonicalSelectionId(iconId: string): string {
  return iconId.startsWith(`${COLLECTION_ID}:`) ? iconId : `${COLLECTION_ID}:${iconId}`;
}

type PreparedSelection = {
  iconId: string;
  normalized: string;
  targets: readonly string[];
  terms: readonly string[];
};

const preparedSelectionsByPolicy = new WeakMap<IconPolicy, readonly PreparedSelection[]>();

function preparedSelections(policy: IconPolicy): readonly PreparedSelection[] {
  const cached = preparedSelectionsByPolicy.get(policy);
  if (cached !== undefined) return cached;

  const prepared = Object.entries(policy.selections).map(([selectionIntent, iconId]) => ({
    iconId,
    normalized: normalizeText(selectionIntent),
    targets: semanticTargets(selectionIntent),
    terms: semanticTerms(selectionIntent),
  }));
  preparedSelectionsByPolicy.set(policy, prepared);
  return prepared;
}

const RESERVED_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function rejectReservedRecordKeys(input: unknown): void {
  if (typeof input !== "object" || input === null) return;
  for (const field of ["contexts", "selections"] as const) {
    const record = (input as Record<string, unknown>)[field];
    if (typeof record !== "object" || record === null) continue;
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key === "string" && RESERVED_RECORD_KEYS.has(key)) {
        throw new IconKernelError({
          code: "INVALID_POLICY",
          message: `Policy "${field}" contains reserved key "${key}".`,
          field: `${field}.${key}`,
        });
      }
    }
  }
}

export function parseIconPolicy(input: unknown): IconPolicy {
  rejectReservedRecordKeys(input);
  const parsed = IconPolicySchema.safeParse(input);
  if (!parsed.success) {
    throw new IconKernelError(
      zodIssuesToKernelError("INVALID_POLICY", parsed.error, "The icon policy is invalid."),
    );
  }

  const normalizedKeys = new Map<string, string>();
  for (const key of Object.keys(parsed.data.selections)) {
    const normalized = normalizeText(key);
    if (!normalized) {
      throw new IconKernelError({
        code: "INVALID_POLICY",
        message: `Semantic selection "${key}" has no searchable letters or numbers.`,
        field: "selections",
      });
    }
    const existing = normalizedKeys.get(normalized);
    if (existing !== undefined) {
      throw new IconKernelError({
        code: "INVALID_POLICY",
        message: `Semantic selections "${existing}" and "${key}" normalize to the same intent.`,
        field: "selections",
      });
    }
    normalizedKeys.set(normalized, key);
  }

  return parsed.data;
}

// Layering order: defaults <- context override <- per-call render override.
// The per-call layer is the same typed object for humans (picker appearance)
// and Agents (render parameter), so both reproduce identical assets.
export function resolveEffectivePolicy(
  policy: IconPolicy,
  context?: string,
  render?: RenderStyleOverride,
): { policy: EffectivePolicy; warnings: PolicyWarning[] } {
  const override = context !== undefined && Object.hasOwn(policy.contexts, context)
    ? policy.contexts[context]
    : undefined;
  const warnings: PolicyWarning[] = [];

  if (context !== undefined && override === undefined) {
    warnings.push({
      code: "CONTEXT_NOT_CONFIGURED",
      message: `Context "${context}" is not configured; the default icon style was applied.`,
    });
  }

  const colors = {
    primary: render?.colors?.primary ?? override?.colors?.primary ?? policy.defaults.colors.primary,
    secondary: render?.colors?.secondary ?? override?.colors?.secondary ?? policy.defaults.colors.secondary,
    innerStroke: render?.colors?.innerStroke ?? override?.colors?.innerStroke ?? policy.defaults.colors.innerStroke,
    innerFill: render?.colors?.innerFill ?? override?.colors?.innerFill ?? policy.defaults.colors.innerFill,
  };

  return {
    policy: {
      theme: render?.theme ?? override?.theme ?? policy.defaults.theme,
      size: render?.size ?? override?.size ?? policy.defaults.size,
      strokeWidth: render?.strokeWidth ?? override?.strokeWidth ?? policy.defaults.strokeWidth,
      strokeLinecap: render?.strokeLinecap ?? override?.strokeLinecap ?? policy.defaults.strokeLinecap,
      strokeLinejoin: render?.strokeLinejoin ?? override?.strokeLinejoin ?? policy.defaults.strokeLinejoin,
      colors,
      context: context ?? null,
    },
    warnings,
  };
}

export function renderStyleEquals(left: RenderStyle, right: RenderStyle): boolean {
  return left.theme === right.theme
    && left.size === right.size
    && left.strokeWidth === right.strokeWidth
    && left.strokeLinecap === right.strokeLinecap
    && left.strokeLinejoin === right.strokeLinejoin
    && left.colors.primary === right.colors.primary
    && left.colors.secondary === right.colors.secondary
    && left.colors.innerStroke === right.colors.innerStroke
    && left.colors.innerFill === right.colors.innerFill;
}

export function findSemanticSelection(policy: IconPolicy, intent: string): string | undefined {
  const normalizedIntent = normalizeText(intent);
  const selections = preparedSelections(policy);

  const exact = selections.find((selection) => selection.normalized === normalizedIntent);
  if (exact !== undefined) return exact.iconId;

  const intentTargets = semanticTargets(intent);
  const intentTerms = semanticTerms(intent);
  const matches = selections.filter((selection) => {
    if (
      intentTargets.length === 1
      && selection.targets.length === 1
      && intentTargets[0] === selection.targets[0]
    ) {
      return true;
    }
    return hasSameTerms(intentTerms, selection.terms);
  });

  if (matches.length === 0) return undefined;
  const selectedIds = new Set(matches.map((match) => canonicalSelectionId(match.iconId)));
  return selectedIds.size === 1 ? matches[0]?.iconId : undefined;
}
