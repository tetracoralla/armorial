import { expandAliases, isGenericTaskTerm } from "./aliases.js";
import { COLLECTION_ID, IconPolicySchema, type IconPolicy, type RenderStyle } from "./contracts.js";
import { IconKernelError } from "./errors.js";
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

export function parseIconPolicy(input: unknown): IconPolicy {
  const parsed = IconPolicySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IconKernelError({
      code: "INVALID_POLICY",
      message: issue?.message ?? "The icon policy is invalid.",
      ...(issue?.path.length ? { field: issue.path.join(".") } : {}),
    });
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

export function resolveEffectivePolicy(
  policy: IconPolicy,
  context?: string,
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
    primary: override?.colors?.primary ?? policy.defaults.colors.primary,
    secondary: override?.colors?.secondary ?? policy.defaults.colors.secondary,
    innerStroke: override?.colors?.innerStroke ?? policy.defaults.colors.innerStroke,
    innerFill: override?.colors?.innerFill ?? policy.defaults.colors.innerFill,
  };

  return {
    policy: {
      theme: override?.theme ?? policy.defaults.theme,
      size: override?.size ?? policy.defaults.size,
      strokeWidth: override?.strokeWidth ?? policy.defaults.strokeWidth,
      strokeLinecap: override?.strokeLinecap ?? policy.defaults.strokeLinecap,
      strokeLinejoin: override?.strokeLinejoin ?? policy.defaults.strokeLinejoin,
      colors,
      context: context ?? null,
    },
    warnings,
  };
}

export function findSemanticSelection(policy: IconPolicy, intent: string): string | undefined {
  const normalizedIntent = normalizeText(intent);
  const selections = Object.entries(policy.selections);

  for (const [selectionIntent, iconId] of selections) {
    if (normalizeText(selectionIntent) === normalizedIntent) {
      return iconId;
    }
  }

  const intentTargets = semanticTargets(intent);
  const intentTerms = semanticTerms(intent);
  const matches = selections.filter(([selectionIntent]) => {
    const selectionTargets = semanticTargets(selectionIntent);
    if (
      intentTargets.length === 1
      && selectionTargets.length === 1
      && intentTargets[0] === selectionTargets[0]
    ) {
      return true;
    }
    return hasSameTerms(intentTerms, semanticTerms(selectionIntent));
  });

  if (matches.length === 0) return undefined;
  const selectedIds = new Set(matches.map(([, iconId]) => canonicalSelectionId(iconId)));
  return selectedIds.size === 1 ? matches[0]?.[1] : undefined;
}
