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
  return `${icon.id} rendered as ${icon.policy.theme}, ${icon.policy.size}px, stroke ${icon.policy.strokeWidth}px.`;
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
