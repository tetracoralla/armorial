import {
  type BrowseIconsInput,
  type BrowseIconsOutput,
  type CatalogItem,
  type ChooseIconInput,
  type IconSelectionDecision,
  type RenderStyleOverride,
} from "../core/contracts.js";
import type {
  FigmaInsertSettings,
  FigmaInsertionReceipt,
  FigmaLocalePreference,
} from "../figma/protocol.js";

// This module is the dependency seam between the Figma UI graph and the
// Agent-hosted (MCP) runtime: it must stay free of `@modelcontextprotocol`
// imports so the Figma bundle never embeds server-side SDK code.

export type CatalogData = Extract<BrowseIconsOutput, { status: "ok" }>;

export type RuntimeMode = "standalone" | "embedded" | "figma";

export interface PickerRuntime {
  readonly mode: RuntimeMode;
  readonly sharedIcon?: { icon: string; sha256: string };
  readonly invalidIconLink?: boolean;
  readonly canAttach: boolean;
  readonly canContinue: boolean;
  readonly canFullscreen: boolean;
  readonly initialCatalog: CatalogData | null;
  readonly session: ChooseIconInput | null;
  onInitialState(listener: (catalog: CatalogData | null, session: ChooseIconInput | null) => void): () => void;
  browse(input: BrowseIconsInput): Promise<BrowseIconsOutput>;
  attach(decision: IconSelectionDecision, message: string): Promise<void>;
  continueTask(message: string): Promise<void>;
  download(filename: string, svg: string): Promise<void>;
  requestFullscreen(): Promise<void>;
}

export type FigmaRuntimeState = {
  settings: FigmaInsertSettings;
  render: RenderStyleOverride | null;
  locale: FigmaLocalePreference;
  pageName: string;
  lastReceipt: FigmaInsertionReceipt | null;
  error: string | null;
  hydrated: boolean;
};

export interface FigmaPickerRuntime extends PickerRuntime {
  readonly mode: "figma";
  readonly figmaState: FigmaRuntimeState;
  onFigmaState(listener: (state: FigmaRuntimeState) => void): () => void;
  saveFigmaSettings(settings: FigmaInsertSettings): void;
  saveFigmaRender(render: RenderStyleOverride | null): void;
  saveFigmaLocale(locale: FigmaLocalePreference): void;
  resizeFigmaUi(compact: boolean): void;
  insertIcon(item: CatalogItem): Promise<FigmaInsertionReceipt>;
  dragIcon(event: DragEvent, item: CatalogItem): void;
}

export function isFigmaPickerRuntime(runtime: PickerRuntime): runtime is FigmaPickerRuntime {
  return runtime.mode === "figma";
}

export function safeFilename(value: string): string {
  const normalized = value.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${normalized || "icon"}.svg`;
}

export function browserDownload(filename: string, svg: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename(filename);
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("The browser did not copy this value.");
}

export function setSvgDragData(event: DragEvent, filename: string, svg: string): void {
  if (event.dataTransfer === null) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("image/svg+xml", svg);
  event.dataTransfer.setData("text/plain", svg);
  event.dataTransfer.setData("DownloadURL", `image/svg+xml:${safeFilename(filename)}:data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}
