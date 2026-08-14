import { App } from "@modelcontextprotocol/ext-apps";
import {
  BrowseIconsOutputSchema,
  ChooseIconInputSchema,
  GetIconOutputSchema,
  type BrowseIconsInput,
  type BrowseIconsOutput,
  type ChooseIconInput,
  type IconSelectionDecision,
} from "../core/contracts.js";

export type CatalogData = Extract<BrowseIconsOutput, { status: "ok" }>;

export type RuntimeMode = "standalone" | "embedded";

export interface PickerRuntime {
  readonly mode: RuntimeMode;
  readonly canAttach: boolean;
  readonly canContinue: boolean;
  readonly canFullscreen: boolean;
  readonly initialCatalog: CatalogData | null;
  readonly session: ChooseIconInput | null;
  onInitialState(listener: (catalog: CatalogData | null, session: ChooseIconInput | null) => void): () => void;
  browse(input: BrowseIconsInput): Promise<BrowseIconsOutput>;
  attach(decision: IconSelectionDecision, message: string): Promise<void>;
  continueTask(decision: IconSelectionDecision, message: string): Promise<void>;
  download(filename: string, svg: string): Promise<void>;
  requestFullscreen(): Promise<void>;
}

type ToolResultEnvelope = {
  structuredContent?: Record<string, unknown> | undefined;
  isError?: boolean | undefined;
};

function extractBrowseResult(value: ToolResultEnvelope): BrowseIconsOutput {
  return BrowseIconsOutputSchema.parse(value.structuredContent?.["result"]);
}

function safeFilename(value: string): string {
  const normalized = value.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${normalized || "icon"}.svg`;
}

function browserDownload(filename: string, svg: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename(filename);
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

class StandaloneRuntime implements PickerRuntime {
  readonly mode = "standalone" as const;
  readonly canAttach = false;
  readonly canContinue = false;
  readonly canFullscreen = false;
  readonly initialCatalog = null;
  readonly session = null;

  onInitialState(): () => void {
    return () => undefined;
  }

  async browse(input: BrowseIconsInput): Promise<BrowseIconsOutput> {
    const response = await fetch("/api/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error("The local icon service rejected this request.");
    return BrowseIconsOutputSchema.parse(payload["result"]);
  }

  async attach(): Promise<void> {
    throw new Error("Open this picker inside an Agent host to attach a selection.");
  }

  async continueTask(): Promise<void> {
    throw new Error("Open this picker inside an Agent host to continue a task.");
  }

  async download(filename: string, svg: string): Promise<void> {
    browserDownload(filename, svg);
  }

  async requestFullscreen(): Promise<void> {
    return Promise.resolve();
  }
}

type EmbeddedInitialState = {
  catalog: CatalogData | null;
  session: ChooseIconInput | null;
  listeners: Set<(catalog: CatalogData | null, session: ChooseIconInput | null) => void>;
};

class EmbeddedRuntime implements PickerRuntime {
  readonly mode = "embedded" as const;
  readonly canAttach: boolean;
  readonly canContinue: boolean;
  readonly canFullscreen: boolean;

  constructor(
    private readonly app: App,
    private readonly initialState: EmbeddedInitialState,
  ) {
    const capabilities = app.getHostCapabilities();
    this.canAttach = capabilities?.updateModelContext !== undefined;
    this.canContinue = capabilities?.message !== undefined;
    this.canFullscreen = app.getHostContext()?.availableDisplayModes?.includes("fullscreen") ?? false;
  }

  get initialCatalog(): CatalogData | null {
    return this.initialState.catalog;
  }

  get session(): ChooseIconInput | null {
    return this.initialState.session;
  }

  onInitialState(listener: (catalog: CatalogData | null, session: ChooseIconInput | null) => void): () => void {
    this.initialState.listeners.add(listener);
    if (this.initialState.catalog !== null || this.initialState.session !== null) {
      listener(this.initialState.catalog, this.initialState.session);
    }
    return () => this.initialState.listeners.delete(listener);
  }

  async browse(input: BrowseIconsInput): Promise<BrowseIconsOutput> {
    const result = await this.app.callServerTool({ name: "browse_icons", arguments: input });
    if (result.isError) throw new Error("The icon picker could not load these candidates.");
    return extractBrowseResult(result);
  }

  async attach(decision: IconSelectionDecision, message: string): Promise<void> {
    if (!this.canAttach) throw new Error("This host cannot attach picker context.");
    await this.app.updateModelContext({
      content: [{ type: "text", text: message }],
      structuredContent: { iconSelection: decision },
    });
  }

  async continueTask(decision: IconSelectionDecision, message: string): Promise<void> {
    if (!this.canContinue) throw new Error("This host cannot send a follow-up from the picker.");
    if (this.canAttach) await this.attach(decision, message);
    const result = await this.app.sendMessage({
      role: "user",
      content: [{ type: "text", text: message }],
    });
    if (result.isError) throw new Error("The host rejected the selected icon message.");
  }

  async download(filename: string, svg: string): Promise<void> {
    const capabilities = this.app.getHostCapabilities();
    if (capabilities?.downloadFile !== undefined) {
      const result = await this.app.downloadFile({
        contents: [{
          type: "resource",
          resource: {
            uri: `file:///${safeFilename(filename)}`,
            mimeType: "image/svg+xml",
            text: svg,
          },
        }],
      });
      if (result.isError) throw new Error("The host did not download this SVG.");
      return;
    }
    browserDownload(filename, svg);
  }

  async requestFullscreen(): Promise<void> {
    if (!this.canFullscreen) return;
    await this.app.requestDisplayMode({ mode: "fullscreen" });
  }
}

function asCatalog(value: BrowseIconsOutput): CatalogData | null {
  return value.status === "ok" ? value : null;
}

export async function createPickerRuntime(): Promise<PickerRuntime> {
  const forceStandalone = new URLSearchParams(window.location.search).get("standalone") === "1";
  if (window.parent === window || forceStandalone) return new StandaloneRuntime();

  const app = new App(
    { name: "Icon SVG Select", version: "0.1.0" },
    {},
    { autoResize: true, strict: true },
  );
  const initialState: EmbeddedInitialState = { catalog: null, session: null, listeners: new Set() };
  const announceInitialState = () => {
    for (const listener of initialState.listeners) listener(initialState.catalog, initialState.session);
  };

  app.ontoolinput = (params) => {
    const parsed = ChooseIconInputSchema.safeParse(params.arguments);
    if (parsed.success) {
      initialState.session = parsed.data;
      announceInitialState();
    }
  };
  app.ontoolresult = (params) => {
    const structured = params.structuredContent;
    if (structured === undefined) return;
    const parsedSession = ChooseIconInputSchema.safeParse(structured["session"]);
    if (parsedSession.success) initialState.session = parsedSession.data;
    const parsedCatalog = BrowseIconsOutputSchema.safeParse(structured["result"]);
    if (parsedCatalog.success) initialState.catalog = asCatalog(parsedCatalog.data);
    announceInitialState();
  };

  await app.connect();
  return new EmbeddedRuntime(app, initialState);
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

export function validateExactIconResult(value: unknown): void {
  GetIconOutputSchema.parse(value);
}
