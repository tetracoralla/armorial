import type {
  GetIconOutput,
  GetIconsOutput,
  ResolveOutput,
  SearchOutput,
} from "../core/contracts.js";

export function presentSearch(output: SearchOutput): string {
  if (output.status === "error") return `${output.error.code}: ${output.error.message}`;
  if (output.items.length === 0) return `No IconPark matches for "${output.query}".`;
  return output.items
    .map((item) => `${item.id}\t${item.title}\t${item.category}\t${item.matchKind}`)
    .join("\n");
}

export function presentGet(output: GetIconOutput): string {
  if (output.status === "error") return `${output.error.code}: ${output.error.message}`;
  const { icon } = output;
  return `${icon.id} rendered as ${icon.policy.theme}, ${icon.policy.size}px, stroke weight ${icon.policy.strokeWidth}.`;
}

export function presentResolve(output: ResolveOutput): string {
  if (output.status === "error") return `${output.error.code}: ${output.error.message}`;
  if (output.status === "ambiguous") {
    return `Ambiguous: ${output.candidates.map((candidate) => candidate.id).join(", ")}`;
  }
  return `${output.icon.id} selected by ${output.selectionMethod} and rendered as ${output.icon.policy.theme}.`;
}

export function presentBatch(output: GetIconsOutput): string {
  if (output.status === "error") return `${output.error.code}: ${output.error.message}`;
  return `${output.summary.rendered}/${output.summary.requested} icons rendered; ${output.summary.failed} failed.`;
}

function asSymbol(svg: string, symbolId: string): string {
  const match = svg.match(/^<\?xml[^>]*><svg\s+([^>]*)>([\s\S]*)<\/svg>$/);
  if (match === null) throw new Error(`Rendered SVG for "${symbolId}" has an unexpected envelope.`);
  const rootAttributes = match[1]!
    .replace(/(?:^|\s)(?:width|height|xmlns)="[^"]*"/g, "")
    .trim();
  return `<symbol id="${symbolId}"${rootAttributes.length > 0 ? ` ${rootAttributes}` : ""}>${match[2]}</symbol>`;
}

export function presentSprite(output: GetIconsOutput, symbolPrefix: string): string {
  if (output.status === "error") return `${output.error.code}: ${output.error.message}`;
  if (output.items.some((item) => item.status === "error")) {
    throw new Error("A sprite cannot be emitted from a partial batch.");
  }

  const symbols = output.items.map((item) => {
    if (item.status === "error") throw new Error("A sprite cannot be emitted from a partial batch.");
    const slug = item.icon.id.replace(/^icon-park:/, "");
    return asSymbol(item.icon.asset.svg, `${symbolPrefix}${slug}`);
  });
  const uniqueIds = new Set(symbols.map((symbol) => symbol.match(/^<symbol id="([^"]+)"/)?.[1]));
  if (uniqueIds.size !== symbols.length) throw new Error("A sprite cannot contain duplicate icon ids.");

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">',
    ...symbols.map((symbol) => `  ${symbol}`),
    "</svg>",
  ].join("\n");
}
