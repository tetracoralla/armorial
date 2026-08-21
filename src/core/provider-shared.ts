import { z } from "zod";
import {
  COLLECTION_ID,
  CollectionCapabilitiesSchema,
  type RenderStyle,
} from "./contracts.js";
import { IconKernelError } from "./errors.js";
import { fillForStyle, finalizeSvg, type RenderedAsset } from "./svg.js";

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

export type IconRenderer = (props: {
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
  strokeWidthUnit: "icon-park-grid",
  adjustableLinecap: true,
  adjustableLinejoin: true,
  supportsThemeTransform: true,
});

export function isIconRenderer(value: unknown): value is IconRenderer {
  return typeof value === "function";
}

export function rendererModuleSlug(name: string): string {
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

type RendererSource = {
  hasRenderer(record: IconRecord): boolean;
  loadRenderer(record: IconRecord): unknown;
};

export class IconParkProviderCore {
  readonly id = COLLECTION_ID;
  readonly capabilities = ICON_PARK_CAPABILITIES;
  readonly records: readonly IconRecord[];

  readonly #recordsBySlug: ReadonlyMap<string, IconRecord>;
  readonly #rendererSource: RendererSource;
  readonly #renderersBySlug = new Map<string, IconRenderer>();

  constructor(rawMetadata: unknown, rendererSource: RendererSource) {
    const metadata = IconMetadataListSchema.safeParse(rawMetadata);
    if (!metadata.success) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: "The pinned IconPark package does not match its expected metadata contract.",
      });
    }

    const records: IconRecord[] = [];
    const recordsBySlug = new Map<string, IconRecord>();
    for (const item of metadata.data) {
      if (recordsBySlug.has(item.name)) {
        throw new IconKernelError({
          code: "ICON_RENDER_FAILED",
          message: `IconPark metadata contains duplicate slug "${item.name}".`,
        });
      }

      const record = { ...item, canonicalId: `${COLLECTION_ID}:${item.name}` };
      if (!rendererSource.hasRenderer(record)) {
        throw new IconKernelError({
          code: "ICON_RENDER_FAILED",
          message: `IconPark metadata entry "${item.name}" has no renderer export.`,
        });
      }
      records.push(record);
      recordsBySlug.set(item.name, record);
    }

    this.records = records;
    this.#recordsBySlug = recordsBySlug;
    this.#rendererSource = rendererSource;
  }

  get(input: string): IconRecord | undefined {
    const slug = input.startsWith(`${COLLECTION_ID}:`) ? input.slice(COLLECTION_ID.length + 1) : input;
    return this.#recordsBySlug.get(slug);
  }

  #renderer(record: IconRecord): IconRenderer {
    const cached = this.#renderersBySlug.get(record.name);
    if (cached !== undefined) return cached;

    let renderer: unknown;
    try {
      renderer = this.#rendererSource.loadRenderer(record);
    } catch {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: `IconPark metadata entry "${record.name}" has no renderer export.`,
      });
    }
    if (!isIconRenderer(renderer)) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: `IconPark metadata entry "${record.name}" has no renderer export.`,
      });
    }
    this.#renderersBySlug.set(record.name, renderer);
    return renderer;
  }

  render(record: IconRecord, style: RenderStyle): RenderedAsset {
    const renderer = this.#renderer(record);

    let rawSvg: string;
    try {
      rawSvg = renderer({
        theme: style.theme,
        size: style.size,
        strokeWidth: style.strokeWidth,
        strokeLinecap: style.strokeLinecap,
        strokeLinejoin: style.strokeLinejoin,
        fill: fillForStyle(style),
      });
    } catch (error) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: error instanceof Error ? error.message : `Icon "${record.canonicalId}" could not be rendered.`,
      });
    }

    return finalizeSvg(record.name, rawSvg, style);
  }
}
