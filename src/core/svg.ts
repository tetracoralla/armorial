import { createHash } from "node:crypto";
import { MAX_SVG_BYTES, type RenderStyle } from "./contracts.js";
import { IconKernelError } from "./errors.js";

const RANDOM_ICON_ID_PATTERN = /icon-[-a-f0-9]{1,16}/gi;
const FORBIDDEN_SVG_PATTERNS = [
  /<script\b/i,
  /<foreignObject\b/i,
  /<animate(?:Motion|Transform|Color)?\b/i,
  /<set\b/i,
  /<(?:image|iframe|embed|object)\b/i,
  /[\s"'/]on[a-z]+\s*=/i,
  /(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|file:|javascript:|\/\/)/i,
  /url\(\s*["']?(?:https?:|data:|file:|javascript:|\/\/)/i,
  /[\s"']src\s*=\s*["']/i,
  /@import\b/i,
] as const;

const SVG_VIEWBOX_PATTERN = /\bviewBox="([^"]+)"/;

export type ParsedSvgViewBox = {
  value: string;
  width: number;
  height: number;
};

export type RenderedAsset = {
  mediaType: "image/svg+xml";
  viewBox: string;
  svg: string;
  bytes: number;
  sha256: string;
};

export function parseSvgViewBox(svg: string): ParsedSvgViewBox | undefined {
  const value = svg.match(SVG_VIEWBOX_PATTERN)?.[1];
  if (value === undefined) return undefined;

  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const width = parts[2];
  const height = parts[3];
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined;
  return { value, width, height };
}

export function fillForStyle(style: RenderStyle): string | string[] {
  switch (style.theme) {
    case "outline":
    case "filled":
      return style.colors.primary;
    case "two-tone":
      return [style.colors.primary, style.colors.secondary];
    case "multi-color":
      return [
        style.colors.primary,
        style.colors.secondary,
        style.colors.innerStroke,
        style.colors.innerFill,
      ];
  }
}

export function finalizeSvg(slug: string, rawSvg: string, style: RenderStyle): RenderedAsset {
  const renderKey = JSON.stringify({ slug, style });
  const stableId = `icon-svg-select-${slug}-${createHash("sha256").update(renderKey).digest("hex").slice(0, 12)}`;
  const svg = rawSvg.replace(RANDOM_ICON_ID_PATTERN, stableId);

  for (const pattern of FORBIDDEN_SVG_PATTERNS) {
    if (pattern.test(svg)) {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: `Icon "${slug}" produced forbidden SVG content.`,
      });
    }
  }

  const viewBox = parseSvgViewBox(svg);
  if (!svg.includes("<svg ") || viewBox === undefined) {
    throw new IconKernelError({
      code: "ICON_RENDER_FAILED",
      message: `Icon "${slug}" produced an invalid IconPark SVG envelope.`,
    });
  }

  const bytes = Buffer.byteLength(svg, "utf8");
  if (bytes > MAX_SVG_BYTES) {
    throw new IconKernelError({
      code: "RESPONSE_TOO_LARGE",
      message: `Rendered SVG exceeds the ${MAX_SVG_BYTES}-byte response limit.`,
    });
  }

  return {
    mediaType: "image/svg+xml",
    viewBox: viewBox.value,
    svg,
    bytes,
    sha256: createHash("sha256").update(svg).digest("hex"),
  };
}
