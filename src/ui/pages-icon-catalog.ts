import type { RenderStyle } from "../core/contracts.js";

export const PAGES_ICON_CATALOG_VERSION = 1 as const;
export const MAX_PAGES_ICON_CATALOG_BYTES = 5 * 1024 * 1024;

const TEMPLATE_SIZE = "__ARMORIAL_SIZE__";
const TEMPLATE_STROKE_WIDTH = "__ARMORIAL_STROKE_WIDTH__";
const TEMPLATE_LINECAP = "__ARMORIAL_LINECAP__";
const TEMPLATE_LINEJOIN = "__ARMORIAL_LINEJOIN__";
const TEMPLATE_COLORS = [
  "__ARMORIAL_COLOR_0__",
  "__ARMORIAL_COLOR_1__",
  "__ARMORIAL_COLOR_2__",
  "__ARMORIAL_COLOR_3__",
] as const;
const TEMPLATE_ICON_ID = "icon-00000000";
const RANDOM_ICON_ID_PATTERN = /icon-[-a-f0-9]{1,16}/gi;

export type PagesIconCatalog = {
  version: typeof PAGES_ICON_CATALOG_VERSION;
  metadata: unknown;
  templates: Record<string, string>;
};

export type IconTemplateSourceRenderer = (props: {
  theme: RenderStyle["theme"];
  size: number | string;
  strokeWidth: number | string;
  strokeLinecap: RenderStyle["strokeLinecap"] | string;
  strokeLinejoin: RenderStyle["strokeLinejoin"] | string;
  fill: string | string[];
}) => string;

export type IconTemplateRenderProps = {
  theme: RenderStyle["theme"];
  size: number;
  strokeWidth: number;
  strokeLinecap: RenderStyle["strokeLinecap"];
  strokeLinejoin: RenderStyle["strokeLinejoin"];
  fill: string | string[];
};

function runtimeColors(props: IconTemplateRenderProps): readonly string[] {
  const fill = typeof props.fill === "string" ? [props.fill] : props.fill;
  const primary = fill[0] ?? "currentColor";
  switch (props.theme) {
    case "outline": return [primary, "none", primary, "none"];
    case "filled": return [primary, primary, "#FFF", "#FFF"];
    case "two-tone": {
      const secondary = fill[1] ?? "#2F88FF";
      return [primary, secondary, primary, secondary];
    }
    case "multi-color": return [
      primary,
      fill[1] ?? "#2F88FF",
      fill[2] ?? "#FFF",
      fill[3] ?? "#43CCF8",
    ];
  }
}

export function createIconTemplate(renderer: IconTemplateSourceRenderer): string {
  const svg = renderer({
    theme: "multi-color",
    size: TEMPLATE_SIZE,
    strokeWidth: TEMPLATE_STROKE_WIDTH,
    strokeLinecap: TEMPLATE_LINECAP,
    strokeLinejoin: TEMPLATE_LINEJOIN,
    fill: [...TEMPLATE_COLORS],
  });
  if (typeof svg !== "string" || !svg.includes("<svg ") || !svg.includes(TEMPLATE_SIZE)) {
    throw new Error("The pinned IconPark renderer did not produce a reusable SVG template.");
  }
  return svg.replace(RANDOM_ICON_ID_PATTERN, TEMPLATE_ICON_ID);
}

export function renderIconTemplate(template: string, props: IconTemplateRenderProps): string {
  const colors = runtimeColors(props);
  let svg = template
    .replaceAll(TEMPLATE_SIZE, String(props.size))
    .replaceAll(TEMPLATE_STROKE_WIDTH, String(props.strokeWidth))
    .replaceAll(TEMPLATE_LINECAP, props.strokeLinecap)
    .replaceAll(TEMPLATE_LINEJOIN, props.strokeLinejoin);
  for (const [index, token] of TEMPLATE_COLORS.entries()) {
    svg = svg.replaceAll(token, colors[index] ?? "none");
  }
  return svg;
}
