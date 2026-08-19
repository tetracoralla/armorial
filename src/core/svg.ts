import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
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

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) index += 1;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

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

export function utf8ByteLength(value: string): number {
  return utf8Bytes(value).byteLength;
}

export function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8Bytes(value)));
}

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

export function assertSafeSvgEnvelope(slug: string, svg: string): ParsedSvgViewBox {
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

  const bytes = utf8ByteLength(svg);
  if (bytes > MAX_SVG_BYTES) {
    throw new IconKernelError({
      code: "RESPONSE_TOO_LARGE",
      message: `Rendered SVG exceeds the ${MAX_SVG_BYTES}-byte response limit.`,
    });
  }
  return viewBox;
}

export function finalizeSvg(slug: string, rawSvg: string, style: RenderStyle): RenderedAsset {
  const renderKey = JSON.stringify({ slug, style });
  const stableId = `icon-svg-select-${slug}-${sha256Hex(renderKey).slice(0, 12)}`;
  const svg = rawSvg.replace(RANDOM_ICON_ID_PATTERN, stableId);

  const viewBox = assertSafeSvgEnvelope(slug, svg);
  const bytes = utf8ByteLength(svg);

  return {
    mediaType: "image/svg+xml",
    viewBox: viewBox.value,
    svg,
    bytes,
    sha256: sha256Hex(svg),
  };
}
