import { createRequire } from "node:module";
import { z } from "zod";
import {
  COLLECTION_ID,
  CollectionCapabilitiesSchema,
  type RenderStyle,
} from "./contracts.js";
import { IconKernelError } from "./errors.js";
import { normalizeIdentifier } from "./normalize.js";
import { fillForStyle, finalizeSvg, parseSvgViewBox, type RenderedAsset } from "./svg.js";

const require = createRequire(import.meta.url);

const IconMetadataSchema = z.strictObject({
  id: z.number().int().nonnegative(),
  title: z.string(),
  name: z.string(),
  category: z.string(),
  categoryCN: z.string(),
  author: z.string(),
  tag: z.array(z.string()),
  rtl: z.boolean(),
});

const IconMetadataListSchema = z.array(IconMetadataSchema).min(1);

type IconRenderer = (props: {
  theme: RenderStyle["theme"];
  size: number;
  strokeWidth: number;
  strokeLinecap: RenderStyle["strokeLinecap"];
  strokeLinejoin: RenderStyle["strokeLinejoin"];
  fill: string | string[];
}) => string;

export type IconRecord = z.infer<typeof IconMetadataSchema> & {
  canonicalId: string;
};

export const ICON_PARK_CAPABILITIES = CollectionCapabilitiesSchema.parse({
  collection: COLLECTION_ID,
  geometry: "mixed",
  viewBoxPolicy: "preserve-source",
  adjustableStrokeWidth: true,
  strokeWidthUnit: "rendered-px",
  adjustableLinecap: true,
  adjustableLinejoin: true,
  supportsThemeTransform: true,
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class IconParkProvider {
  readonly id = COLLECTION_ID;
  readonly capabilities = ICON_PARK_CAPABILITIES;
  readonly records: readonly IconRecord[];

  readonly #recordsBySlug: ReadonlyMap<string, IconRecord>;
  readonly #renderersBySlug: ReadonlyMap<string, IconRenderer>;
  readonly #viewBoxExtentBySlug = new Map<string, number>();

  constructor() {
    const rawMetadata: unknown = require("@icon-park/svg/icons.json");
    const rawExports: unknown = require("@icon-park/svg");
    const metadata = IconMetadataListSchema.safeParse(rawMetadata);

    if (!metadata.success || !isObject(rawExports)) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: "The pinned IconPark package does not match its expected metadata contract.",
      });
    }

    const rendererByNormalizedName = new Map<string, IconRenderer>();
    for (const [exportName, exported] of Object.entries(rawExports)) {
      if (typeof exported !== "function") continue;
      const normalized = normalizeIdentifier(exportName);
      if (rendererByNormalizedName.has(normalized)) {
        throw new IconKernelError({
          code: "ICON_RENDER_FAILED",
          message: `The IconPark export map contains a normalized name collision for "${exportName}".`,
        });
      }
      rendererByNormalizedName.set(normalized, exported as IconRenderer);
    }

    const records: IconRecord[] = [];
    const recordsBySlug = new Map<string, IconRecord>();
    const renderersBySlug = new Map<string, IconRenderer>();

    for (const item of metadata.data) {
      const renderer = rendererByNormalizedName.get(normalizeIdentifier(item.name));
      if (renderer === undefined) {
        throw new IconKernelError({
          code: "ICON_RENDER_FAILED",
          message: `IconPark metadata entry "${item.name}" has no renderer export.`,
        });
      }
      if (recordsBySlug.has(item.name)) {
        throw new IconKernelError({
          code: "ICON_RENDER_FAILED",
          message: `IconPark metadata contains duplicate slug "${item.name}".`,
        });
      }

      const record = { ...item, canonicalId: `${COLLECTION_ID}:${item.name}` };
      records.push(record);
      recordsBySlug.set(item.name, record);
      renderersBySlug.set(item.name, renderer);
    }

    this.records = records;
    this.#recordsBySlug = recordsBySlug;
    this.#renderersBySlug = renderersBySlug;
  }

  canonicalizeId(input: string): string {
    const slug = input.startsWith(`${COLLECTION_ID}:`) ? input.slice(COLLECTION_ID.length + 1) : input;
    return `${COLLECTION_ID}:${slug}`;
  }

  get(input: string): IconRecord | undefined {
    const slug = input.startsWith(`${COLLECTION_ID}:`) ? input.slice(COLLECTION_ID.length + 1) : input;
    return this.#recordsBySlug.get(slug);
  }

  render(record: IconRecord, style: RenderStyle): RenderedAsset {
    const renderer = this.#renderersBySlug.get(record.name);
    if (renderer === undefined) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: `Icon "${record.canonicalId}" has no renderer.`,
      });
    }

    let rawSvg: string;
    try {
      const renderWithStrokeWidth = (strokeWidth: number) => renderer({
        theme: style.theme,
        size: style.size,
        strokeWidth,
        strokeLinecap: style.strokeLinecap,
        strokeLinejoin: style.strokeLinejoin,
        fill: fillForStyle(style),
      });

      let viewBoxExtent = this.#viewBoxExtentBySlug.get(record.name);
      let provisionalSvg: string | undefined;
      if (viewBoxExtent === undefined) {
        provisionalSvg = renderWithStrokeWidth(style.strokeWidth);
        const viewBox = parseSvgViewBox(provisionalSvg);
        if (viewBox === undefined) {
          throw new IconKernelError({
            code: "ICON_RENDER_FAILED",
            message: `Icon "${record.canonicalId}" produced an invalid IconPark SVG viewBox.`,
          });
        }
        viewBoxExtent = Math.max(viewBox.width, viewBox.height);
        this.#viewBoxExtentBySlug.set(record.name, viewBoxExtent);
      }

      const nativeStrokeWidth = style.strokeWidth * viewBoxExtent / style.size;
      rawSvg = nativeStrokeWidth === style.strokeWidth && provisionalSvg !== undefined
        ? provisionalSvg
        : renderWithStrokeWidth(nativeStrokeWidth);
    } catch (error) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: error instanceof Error ? error.message : `Icon "${record.canonicalId}" could not be rendered.`,
      });
    }

    return finalizeSvg(record.name, rawSvg, style);
  }
}
