import {
  DEFAULT_POLICY,
  MAX_UI_CATALOG_ITEMS,
  type BrowseIconsInput,
  type BrowseIconsOutput,
  type CatalogItem,
  type IconSelectionDecision,
  type RenderStyleOverride,
} from "../core/contracts.js";
import { IconKernel } from "../core/kernel.js";
import {
  DEFAULT_FIGMA_INSERT_SETTINGS,
  FigmaMainMessageSchema,
  type FigmaInsertRequest,
  type FigmaInsertSettings,
  type FigmaInsertionReceipt,
} from "./protocol.js";
import type {
  FigmaPickerRuntime,
  FigmaRuntimeState,
} from "../ui/runtime.js";
import { browserDownload } from "../ui/runtime.js";

type PendingInsertion = {
  resolve: (receipt: FigmaInsertionReceipt) => void;
  reject: (error: Error) => void;
};

function requestId(): string {
  return `armorial-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function postPluginMessage(message: unknown): void {
  window.parent.postMessage({ pluginMessage: message }, "*");
}

export class FigmaRuntime implements FigmaPickerRuntime {
  readonly mode = "figma" as const;
  readonly canAttach = false;
  readonly canContinue = false;
  readonly canFullscreen = false;
  readonly session = null;
  readonly initialCatalog;

  readonly #kernel = new IconKernel(DEFAULT_POLICY);
  readonly #listeners = new Set<(state: FigmaRuntimeState) => void>();
  readonly #pending = new Map<string, PendingInsertion>();
  #state: FigmaRuntimeState = {
    settings: DEFAULT_FIGMA_INSERT_SETTINGS,
    render: null,
    pageName: "Current page",
    lastReceipt: null,
    error: null,
    hydrated: false,
  };

  constructor() {
    const initial = this.#kernel.browse({ query: "", offset: 0, limit: MAX_UI_CATALOG_ITEMS });
    this.initialCatalog = initial.status === "ok" ? initial : null;
    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      const parsed = FigmaMainMessageSchema.safeParse(
        typeof event.data === "object" && event.data !== null && "pluginMessage" in event.data
          ? event.data.pluginMessage
          : undefined,
      );
      if (!parsed.success) return;
      this.#receive(parsed.data);
    });
    postPluginMessage({ type: "request-state" });
  }

  get figmaState(): FigmaRuntimeState {
    return this.#state;
  }

  onInitialState(): () => void {
    return () => undefined;
  }

  onFigmaState(listener: (state: FigmaRuntimeState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  async browse(input: BrowseIconsInput): Promise<BrowseIconsOutput> {
    return this.#kernel.browse(input);
  }

  saveFigmaSettings(settings: FigmaInsertSettings): void {
    this.#setState({ ...this.#state, settings, error: null });
    postPluginMessage({ type: "save-settings", settings });
  }

  saveFigmaRender(render: RenderStyleOverride | null): void {
    postPluginMessage({ type: "save-render", render });
  }

  resizeFigmaUi(compact: boolean): void {
    postPluginMessage({ type: "resize-ui", mode: compact ? "compact" : "full" });
  }

  insertIcon(item: CatalogItem): Promise<FigmaInsertionReceipt> {
    const id = requestId();
    const request: FigmaInsertRequest = {
      type: "insert-icon",
      requestId: id,
      asset: { id: item.id, name: item.name, svg: item.asset.svg, sha256: item.asset.sha256 },
      settings: this.#state.settings,
    };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      postPluginMessage(request);
    });
  }

  dragIcon(event: DragEvent, item: CatalogItem): void {
    // Figma documents a zero-length event view when the drag ends inside the
    // plugin iframe. Forwarding that event as pluginDrop would create a canvas
    // node at an unrelated translated coordinate even though the user never
    // left the picker.
    if (event.view === null || event.view.length === 0) return;

    const id = requestId();
    window.parent.postMessage({
      pluginDrop: {
        clientX: event.clientX,
        clientY: event.clientY,
        items: [{ type: "image/svg+xml", data: item.asset.svg }],
        dropMetadata: {
          source: "armorial",
          requestId: id,
          asset: { id: item.id, name: item.name, sha256: item.asset.sha256 },
          settings: this.#state.settings,
        },
      },
    }, "*");
  }

  async attach(_decision: IconSelectionDecision, _message: string): Promise<void> {
    throw new Error("Figma insertion uses the canvas instead of Agent context.");
  }

  async continueTask(_message: string): Promise<void> {
    throw new Error("Figma insertion uses the canvas instead of Agent messaging.");
  }

  async download(filename: string, svg: string): Promise<void> {
    browserDownload(filename, svg);
  }

  async requestFullscreen(): Promise<void> {
    return Promise.resolve();
  }

  #receive(message: ReturnType<typeof FigmaMainMessageSchema.parse>): void {
    if (message.type === "state") {
      this.#setState({
        ...this.#state,
        settings: message.settings,
        render: message.render,
        pageName: message.pageName,
        hydrated: true,
      });
      return;
    }
    if (message.type === "insert-result") {
      this.#setState({ ...this.#state, lastReceipt: message.receipt, error: null });
      const pending = this.#pending.get(message.receipt.requestId);
      pending?.resolve(message.receipt);
      this.#pending.delete(message.receipt.requestId);
      return;
    }
    this.#setState({ ...this.#state, error: message.message });
    if (message.requestId !== null) {
      const pending = this.#pending.get(message.requestId);
      pending?.reject(new Error(message.message));
      this.#pending.delete(message.requestId);
    }
  }

  #setState(next: FigmaRuntimeState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener(next);
  }
}
