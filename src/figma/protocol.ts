import { z } from "zod";
import {
  IconIdSchema,
  IconSlugSchema,
  MAX_SVG_BYTES,
  RenderStyleOverrideSchema,
} from "../core/contracts.js";

export const FigmaLayerStructureSchema = z.enum(["preserve", "flatten", "union"]);
export const FigmaLayerNameSchema = z.enum(["icon-name", "Vector", "Union"]);

export const FigmaInsertSettingsSchema = z.strictObject({
  createComponent: z.boolean(),
  outlineStroke: z.boolean(),
  layerStructure: FigmaLayerStructureSchema,
  layerName: FigmaLayerNameSchema,
});

export const DEFAULT_FIGMA_INSERT_SETTINGS = FigmaInsertSettingsSchema.parse({
  createComponent: true,
  outlineStroke: false,
  layerStructure: "preserve",
  layerName: "icon-name",
});

export const FigmaPluginSettingsSchema = z.strictObject({
  insert: FigmaInsertSettingsSchema,
  render: RenderStyleOverrideSchema.nullable(),
});

export const DEFAULT_FIGMA_PLUGIN_SETTINGS = FigmaPluginSettingsSchema.parse({
  insert: DEFAULT_FIGMA_INSERT_SETTINGS,
  render: null,
});

export const FigmaInsertAssetSchema = z.strictObject({
  id: IconIdSchema,
  name: IconSlugSchema,
  svg: z.string().min(1).max(MAX_SVG_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const FigmaInsertRequestSchema = z.strictObject({
  type: z.literal("insert-icon"),
  requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
  asset: FigmaInsertAssetSchema,
  settings: FigmaInsertSettingsSchema,
});

export const FigmaDropMetadataSchema = z.strictObject({
  source: z.literal("armorial"),
  requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
  asset: FigmaInsertAssetSchema.omit({ svg: true }),
  settings: FigmaInsertSettingsSchema,
});

export const FigmaUiMessageSchema = z.union([
  z.strictObject({ type: z.literal("request-state") }),
  z.strictObject({ type: z.literal("save-settings"), settings: FigmaInsertSettingsSchema }),
  z.strictObject({ type: z.literal("save-render"), render: RenderStyleOverrideSchema.nullable() }),
  z.strictObject({ type: z.literal("resize-ui"), mode: z.enum(["full", "compact"]) }),
  FigmaInsertRequestSchema,
]);

export type FigmaLayerStructure = z.infer<typeof FigmaLayerStructureSchema>;
export type FigmaLayerName = z.infer<typeof FigmaLayerNameSchema>;
export type FigmaInsertSettings = z.infer<typeof FigmaInsertSettingsSchema>;
export type FigmaPluginSettings = z.infer<typeof FigmaPluginSettingsSchema>;
export type FigmaInsertRequest = z.infer<typeof FigmaInsertRequestSchema>;
export type FigmaDropMetadata = z.infer<typeof FigmaDropMetadataSchema>;

export const FigmaInsertionReceiptSchema = z.strictObject({
  requestId: z.string(),
  nodeId: z.string(),
  nodeType: z.string(),
  nodeName: z.string(),
  parentId: z.string(),
  parentName: z.string(),
  placement: z.enum(["click", "drop"]),
  component: z.boolean(),
  outlinedNodeCount: z.number().int().nonnegative(),
  layerStructure: FigmaLayerStructureSchema,
});

export const FigmaMainMessageSchema = z.union([
  z.strictObject({
    type: z.literal("state"),
    settings: FigmaInsertSettingsSchema,
    render: RenderStyleOverrideSchema.nullable(),
    pageName: z.string(),
  }),
  z.strictObject({ type: z.literal("insert-result"), receipt: FigmaInsertionReceiptSchema }),
  z.strictObject({
    type: z.literal("operation-error"),
    requestId: z.string().nullable(),
    message: z.string(),
  }),
]);

export type FigmaInsertionReceipt = z.infer<typeof FigmaInsertionReceiptSchema>;
export type FigmaMainMessage = z.infer<typeof FigmaMainMessageSchema>;
