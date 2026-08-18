import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  COLLECTION_ID,
  CollectionCapabilitiesSchema,
  type RenderStyle,
} from "./contracts.js";
import { IconKernelError } from "./errors.js";
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

function isIconRenderer(value: unknown): value is IconRenderer {
  return typeof value === "function";
}

function rendererModuleSlug(name: string): string {
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

export class IconParkProvider {
  readonly id = COLLECTION_ID;
  readonly capabilities = ICON_PARK_CAPABILITIES;
  readonly records: readonly IconRecord[];

  readonly #recordsBySlug: ReadonlyMap<string, IconRecord>;
  readonly #rendererModulesDir: string;
  readonly #renderersBySlug = new Map<string, IconRenderer>();
  readonly #viewBoxExtentBySlug = new Map<string, number>();

  constructor() {
    const rawMetadata: unknown = require("@icon-park/svg/icons.json");
    const metadata = IconMetadataListSchema.safeParse(rawMetadata);
    if (!metadata.success) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: "The pinned IconPark package does not match its expected metadata contract.",
      });
    }

    const rendererModulesDir = join(
      dirname(require.resolve("@icon-park/svg/package.json")),
      "lib",
      "icons",
    );
    let rendererFiles: ReadonlySet<string>;
    try {
      rendererFiles = new Set(readdirSync(rendererModulesDir).filter((fileName) => fileName.endsWith(".js")));
    } catch {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: "The pinned IconPark package does not expose its per-icon renderer modules.",
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
      if (!rendererFiles.has(`${rendererModuleSlug(item.name)}.js`)) {
        throw new IconKernelError({
          code: "ICON_RENDER_FAILED",
          message: `IconPark metadata entry "${item.name}" has no renderer export.`,
        });
      }

      const record = { ...item, canonicalId: `${COLLECTION_ID}:${item.name}` };
      records.push(record);
      recordsBySlug.set(item.name, record);
    }

    this.records = records;
    this.#recordsBySlug = recordsBySlug;
    this.#rendererModulesDir = rendererModulesDir;
  }

  get(input: string): IconRecord | undefined {
    const slug = input.startsWith(`${COLLECTION_ID}:`) ? input.slice(COLLECTION_ID.length + 1) : input;
    return this.#recordsBySlug.get(slug);
  }

  #renderer(record: IconRecord): IconRenderer {
    const cached = this.#renderersBySlug.get(record.name);
    if (cached !== undefined) return cached;

    let module: unknown;
    try {
      module = require(join(this.#rendererModulesDir, `${rendererModuleSlug(record.name)}.js`));
    } catch {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: `IconPark metadata entry "${record.name}" has no renderer export.`,
      });
    }
    const renderer = (module as { default?: unknown }).default;
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
