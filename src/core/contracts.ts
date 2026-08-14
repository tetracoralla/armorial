import { z } from "zod";
import {
  canonicalizeSvgColor,
  CSS_COLOR_KEYWORD_PATTERN,
  CSS_NAMED_COLOR_VALUES,
  CSS_VARIABLE_PATTERN,
  HEX_COLOR_PATTERN,
} from "./css-color.js";

export const KERNEL_VERSION = "0.1.0";
export const COLLECTION_ID = "icon-park" as const;
export const MAX_QUERY_LENGTH = 120;
export const MAX_SEARCH_RESULTS = 20;
export const MAX_BATCH_SIZE = 20;
export const MAX_SVG_BYTES = 64 * 1024;
export const MAX_BATCH_RESPONSE_BYTES = 512 * 1024;
export const MAX_POLICY_BYTES = 64 * 1024;
export const MAX_MCP_TOOL_CATALOG_BYTES = 24 * 1024;
export const MAX_MCP_APP_RESOURCE_BYTES = 900 * 1024;
export const MAX_POLICY_CONTEXTS = 32;
export const MAX_POLICY_SELECTIONS = 256;
export const MAX_UI_CATALOG_ITEMS = 60;
export const MAX_UI_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_SELECTION_REQUEST_ID_LENGTH = 120;

const ICON_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ICON_ID_PATTERN = /^(?:icon-park:)?[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;

export const ThemeSchema = z.enum(["outline", "filled", "two-tone", "multi-color"]);
export const StrokeLinecapSchema = z.enum(["butt", "round", "square"]);
export const StrokeLinejoinSchema = z.enum(["miter", "round", "bevel"]);
export const CollectionIdSchema = z.literal(COLLECTION_ID);
export const ContextSchema = z.string().regex(CONTEXT_PATTERN, "Use a 1-40 character context key.");
export const IconSlugSchema = z.string().regex(ICON_SLUG_PATTERN, "Use a lowercase IconPark slug.");
export const IconIdSchema = z
  .string()
  .max(96)
  .regex(ICON_ID_PATTERN, "Use an IconPark slug or icon-park:<slug>.");

export const SafeColorSchema = z.preprocess(
  canonicalizeSvgColor,
  z.union([
    z.string().max(64).regex(HEX_COLOR_PATTERN, "Use a 3/4/6/8-digit hex color."),
    z.string().max(64).regex(CSS_VARIABLE_PATTERN, "Use var(--token) without a fallback."),
    z.enum(["currentColor", "none", "transparent", ...CSS_NAMED_COLOR_VALUES]),
    z.string().max(64).regex(CSS_COLOR_KEYWORD_PATTERN, "Use a supported CSS color keyword."),
  ]),
);

export const ColorPaletteSchema = z
  .strictObject({
    primary: SafeColorSchema,
    secondary: SafeColorSchema,
    innerStroke: SafeColorSchema,
    innerFill: SafeColorSchema,
  });

export const RenderStyleSchema = z.strictObject({
  theme: ThemeSchema,
  size: z.number().int().min(8).max(512),
  strokeWidth: z.number().min(0.5).max(16)
    .describe("Final visible stroke width in CSS pixels at the configured icon size."),
  strokeLinecap: StrokeLinecapSchema,
  strokeLinejoin: StrokeLinejoinSchema,
  colors: ColorPaletteSchema,
});

export const RenderStyleOverrideSchema = z.strictObject({
  theme: ThemeSchema.optional(),
  size: z.number().int().min(8).max(512).optional(),
  strokeWidth: z.number().min(0.5).max(16)
    .describe("Final visible stroke width in CSS pixels at the configured icon size.")
    .optional(),
  strokeLinecap: StrokeLinecapSchema.optional(),
  strokeLinejoin: StrokeLinejoinSchema.optional(),
  colors: ColorPaletteSchema.partial().optional(),
});

export const ContextsSchema = z
  .record(ContextSchema, RenderStyleOverrideSchema)
  .refine(
    (value) => Object.keys(value).length <= MAX_POLICY_CONTEXTS,
    `A policy may define at most ${MAX_POLICY_CONTEXTS} contexts.`,
  );

export const SelectionsSchema = z
  .record(z.string().min(1).max(80), IconIdSchema)
  .refine(
    (value) => Object.keys(value).length <= MAX_POLICY_SELECTIONS,
    `A policy may define at most ${MAX_POLICY_SELECTIONS} semantic selections.`,
  );

export const IconPolicySchema = z.strictObject({
  version: z.literal(1),
  collections: z.array(CollectionIdSchema).length(1),
  defaults: RenderStyleSchema,
  contexts: ContextsSchema,
  selections: SelectionsSchema,
});

export const DEFAULT_POLICY = IconPolicySchema.parse({
  version: 1,
  collections: [COLLECTION_ID],
  defaults: {
    theme: "outline",
    size: 24,
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    colors: {
      primary: "currentColor",
      secondary: "#2F88FF",
      innerStroke: "#FFFFFF",
      innerFill: "#43CCF8",
    },
  },
  contexts: {},
  selections: {},
});

export type IconPolicy = z.infer<typeof IconPolicySchema>;
export type RenderStyle = z.infer<typeof RenderStyleSchema>;
export type Theme = z.infer<typeof ThemeSchema>;

export const SearchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(8),
});

export const ResolveInputSchema = z.strictObject({
  intent: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  context: ContextSchema.optional(),
  alternatives: z.number().int().min(0).max(8).default(3),
});

export const GetIconInputSchema = z.strictObject({
  id: IconIdSchema,
  context: ContextSchema.optional(),
});

export const GetIconsInputSchema = z.strictObject({
  ids: z.array(IconIdSchema).min(1).max(MAX_BATCH_SIZE),
  context: ContextSchema.optional(),
});

export const BrowseIconsInputSchema = z.strictObject({
  query: z.string().trim().max(MAX_QUERY_LENGTH).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  context: ContextSchema.optional(),
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(MAX_UI_CATALOG_ITEMS).default(MAX_UI_CATALOG_ITEMS),
});

export const ChooseIconInputSchema = z.strictObject({
  intent: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  context: ContextSchema.optional(),
  requestId: z.string().regex(REQUEST_ID_PATTERN, "Use a bounded opaque request id.").optional(),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
export type ResolveInput = z.infer<typeof ResolveInputSchema>;
export type GetIconInput = z.infer<typeof GetIconInputSchema>;
export type GetIconsInput = z.infer<typeof GetIconsInputSchema>;
export type BrowseIconsInput = z.infer<typeof BrowseIconsInputSchema>;
export type ChooseIconInput = z.infer<typeof ChooseIconInputSchema>;

export const MatchKindSchema = z.enum([
  "exact_id",
  "exact_name",
  "exact_title",
  "exact_tag",
  "alias",
  "token",
  "contains",
  "category",
]);

export const CandidateSchema = z.strictObject({
  id: z.string(),
  collection: CollectionIdSchema,
  name: z.string(),
  title: z.string(),
  category: z.string(),
  categoryCN: z.string(),
  rankScore: z.number().int(),
  matchKind: MatchKindSchema,
  matchedOn: z.array(z.string()).max(8),
});

export const WarningSchema = z.strictObject({
  code: z.enum(["CONTEXT_NOT_CONFIGURED"]),
  message: z.string(),
});

export const CollectionCapabilitiesSchema = z.strictObject({
  collection: CollectionIdSchema,
  geometry: z.literal("mixed"),
  viewBoxPolicy: z.literal("preserve-source"),
  adjustableStrokeWidth: z.literal(true),
  strokeWidthUnit: z.literal("rendered-px"),
  adjustableLinecap: z.literal(true),
  adjustableLinejoin: z.literal(true),
  supportsThemeTransform: z.literal(true),
});

const ValidatedColorPaletteSchema = z.strictObject({
  primary: z.string().max(64),
  secondary: z.string().max(64),
  innerStroke: z.string().max(64),
  innerFill: z.string().max(64),
});

const EffectiveRenderStyleSchema = RenderStyleSchema.extend({
  colors: ValidatedColorPaletteSchema,
});

export const EffectivePolicySchema = EffectiveRenderStyleSchema.extend({
  context: ContextSchema.nullable(),
});

export const RenderedAssetSchema = z.strictObject({
  mediaType: z.literal("image/svg+xml"),
  viewBox: z.string(),
  svg: z.string().max(MAX_SVG_BYTES),
  bytes: z.number().int().nonnegative().max(MAX_SVG_BYTES),
  sha256: z.string().length(64),
});

export const IconResultSchema = z.strictObject({
  id: z.string(),
  collection: CollectionIdSchema,
  name: z.string(),
  title: z.string(),
  category: z.string(),
  categoryCN: z.string(),
  license: z.literal("Apache-2.0"),
  policy: EffectivePolicySchema,
  capabilities: CollectionCapabilitiesSchema,
  policyCompliance: z.literal("compliant"),
  asset: RenderedAssetSchema,
  warnings: z.array(WarningSchema),
});

export const ErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "INVALID_POLICY",
  "ICON_NOT_FOUND",
  "ICON_AMBIGUOUS",
  "ICON_RENDER_FAILED",
  "RESPONSE_TOO_LARGE",
  "POLICY_FILE_TOO_LARGE",
  "POLICY_FILE_READ_FAILED",
]);

export const ErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: z.string(),
  field: z.string().optional(),
});

export const SearchSuccessSchema = z.strictObject({
  status: z.literal("ok"),
  kind: z.literal("icon_search"),
  query: z.string(),
  items: z.array(CandidateSchema),
  truncated: z.boolean(),
});

export const FailureSchema = z.strictObject({
  status: z.literal("error"),
  error: ErrorSchema,
});

export const SearchOutputSchema = z.union([SearchSuccessSchema, FailureSchema]);

export const GetIconSuccessSchema = z.strictObject({
  status: z.literal("ok"),
  kind: z.literal("icon"),
  icon: IconResultSchema,
});

export const GetIconOutputSchema = z.union([GetIconSuccessSchema, FailureSchema]);

export const ResolveSuccessSchema = z.strictObject({
  status: z.literal("ok"),
  kind: z.literal("icon_resolution"),
  intent: z.string(),
  selectionMethod: z.enum(["policy", "exact_id", "exact_name", "ranked"]),
  icon: IconResultSchema,
  alternatives: z.array(CandidateSchema),
});

export const ResolveAmbiguousSchema = z.strictObject({
  status: z.literal("ambiguous"),
  kind: z.literal("icon_resolution"),
  intent: z.string(),
  error: z.strictObject({
    code: z.literal("ICON_AMBIGUOUS"),
    message: z.string(),
  }),
  candidates: z.array(CandidateSchema).min(2).max(8),
});

export const ResolveOutputSchema = z.union([ResolveSuccessSchema, ResolveAmbiguousSchema, FailureSchema]);

export const BatchItemSchema = z.union([
  z.strictObject({
    index: z.number().int().nonnegative(),
    inputId: z.string(),
    status: z.literal("ok"),
    icon: IconResultSchema,
  }),
  z.strictObject({
    index: z.number().int().nonnegative(),
    inputId: z.string(),
    status: z.literal("error"),
    error: ErrorSchema,
  }),
]);

export const GetIconsSuccessSchema = z.strictObject({
  status: z.literal("ok"),
  kind: z.literal("icon_batch"),
  items: z.array(BatchItemSchema).max(MAX_BATCH_SIZE),
  summary: z.strictObject({
    requested: z.number().int().nonnegative(),
    rendered: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});

export const GetIconsOutputSchema = z.union([GetIconsSuccessSchema, FailureSchema]);

export const CatalogCategorySchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  labelCN: z.string(),
  count: z.number().int().nonnegative(),
});

export const CatalogItemSchema = z.strictObject({
  id: z.string(),
  collection: CollectionIdSchema,
  name: z.string(),
  title: z.string(),
  category: z.string(),
  categoryCN: z.string(),
  asset: RenderedAssetSchema,
});

export const BrowseIconsSuccessSchema = z.strictObject({
  status: z.literal("ok"),
  kind: z.literal("icon_catalog"),
  query: z.string(),
  category: z.string().nullable(),
  context: ContextSchema.nullable(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  policy: EffectivePolicySchema,
  categories: z.array(CatalogCategorySchema),
  items: z.array(CatalogItemSchema).max(MAX_UI_CATALOG_ITEMS),
});

export const BrowseIconsOutputSchema = z.union([BrowseIconsSuccessSchema, FailureSchema]);

export const IconSelectionDecisionSchema = z.strictObject({
  kind: z.literal("icon_selection"),
  version: z.literal(1),
  decisionId: z.string().length(64),
  requestId: z.string().regex(REQUEST_ID_PATTERN, "Use a bounded opaque request id.").optional(),
  iconId: IconIdSchema,
  intent: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  context: ContextSchema.nullable(),
  assetSha256: z.string().length(64),
  scope: z.literal("current_task"),
});

export const IconSelectionDecisionInputSchema = z.strictObject({
  requestId: z.string().regex(REQUEST_ID_PATTERN, "Use a bounded opaque request id.").optional(),
  iconId: IconIdSchema,
  intent: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  context: ContextSchema.nullable(),
  assetSha256: z.string().length(64),
});

export type Candidate = z.infer<typeof CandidateSchema>;
export type SearchOutput = z.infer<typeof SearchOutputSchema>;
export type GetIconOutput = z.infer<typeof GetIconOutputSchema>;
export type ResolveOutput = z.infer<typeof ResolveOutputSchema>;
export type GetIconsOutput = z.infer<typeof GetIconsOutputSchema>;
export type BrowseIconsOutput = z.infer<typeof BrowseIconsOutputSchema>;
export type IconResult = z.infer<typeof IconResultSchema>;
export type KernelError = z.infer<typeof ErrorSchema>;
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type IconSelectionDecision = z.infer<typeof IconSelectionDecisionSchema>;
export type IconSelectionDecisionInput = z.infer<typeof IconSelectionDecisionInputSchema>;
