import { App } from "@modelcontextprotocol/ext-apps";
import {
  BrowseIconsOutputSchema,
  ChooseIconInputSchema,
  ICON_PICKER_SESSION_META_KEY,
  KERNEL_VERSION,
  type BrowseIconsInput,
  type BrowseIconsOutput,
} from "../core/contracts.js";
import { readIconLink } from "./icon-link.js";
import { browseStandaloneIcons } from "./standalone-browse.js";
import { browserDownload, safeFilename, type CatalogData, type PickerRuntime } from "./runtime-shared.js";

export {
  browserDownload,
  copyText,
  isFigmaPickerRuntime,
  safeFilename,
  setSvgDragData,
} from "./runtime-shared.js";
export type {
  CatalogData,
  FigmaPickerRuntime,
  FigmaRuntimeState,
  PickerRuntime,
  RuntimeMode,
} from "./runtime-shared.js";

import type { ChooseIconInput, IconSelectionDecision } from "../core/contracts.js";

type ToolResultEnvelope = {
  structuredContent?: Record<string, unknown> | undefined;
  isError?: boolean | undefined;
};

function extractBrowseResult(value: ToolResultEnvelope): BrowseIconsOutput {
  const parsed = BrowseIconsOutputSchema.safeParse(value.structuredContent?.["result"]);
  if (!parsed.success) throw new Error("The icon picker could not load these candidates.");
  return parsed.data;
}

class StandaloneRuntime implements PickerRuntime {
  readonly mode = "standalone" as const;
  readonly canAttach = false;
  readonly canContinue = false;
  readonly canFullscreen = false;
  readonly initialCatalog = null;
  session: ChooseIconInput | null = null;
  sharedIcon?: { icon: string; sha256: string };
  invalidIconLink = false;

  constructor() { this.readLocation(); }

  private readLocation(): void {
    delete this.sharedIcon;
    try {
      const shared = readIconLink(window.location.hash);
      this.session = shared === null ? null : { intent: shared.icon, render: shared.render };
      if (shared !== null) this.sharedIcon = { icon: shared.icon, sha256: shared.sha256 };
      this.invalidIconLink = false;
    } catch {
      this.session = null;
      this.invalidIconLink = true;
    }
  }

  onInitialState(listener: (catalog: CatalogData | null, session: ChooseIconInput | null) => void): () => void {
    const changed = () => {
      this.readLocation();
      listener(null, this.session);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }

  async browse(input: BrowseIconsInput): Promise<BrowseIconsOutput> {
    return browseStandaloneIcons(input);
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

export class EmbeddedRuntime implements PickerRuntime {
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
    const output = extractBrowseResult(result);
    if (output.status === "error") throw new Error(output.error.message);
    return output;
  }

  async attach(decision: IconSelectionDecision, message: string): Promise<void> {
    if (!this.canAttach) throw new Error("This host cannot attach picker context.");
    await this.app.updateModelContext({
      content: [{ type: "text", text: message }],
      structuredContent: { iconSelection: decision },
    });
  }

  async continueTask(message: string): Promise<void> {
    if (!this.canContinue) throw new Error("This host cannot send a follow-up from the picker.");
    // One commit mechanism only: the user-role message already carries the
    // typed decision text. updateModelContext content is deferred by hosts
    // until the next ui/message, so attaching here as well would deliver the
    // same decision twice and leave context applied if the message is rejected.
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
    { name: "Armorial", version: KERNEL_VERSION },
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
    const metaSession = ChooseIconInputSchema.safeParse(params._meta?.[ICON_PICKER_SESSION_META_KEY]);
    // Keep accepting the v0.1 structured echo when an older server serves a
    // newer cached app. Current servers use hidden result metadata so the
    // model-visible output remains compact and fully typed.
    const structuredSession = ChooseIconInputSchema.safeParse(structured["session"]);
    const parsedSession = metaSession.success ? metaSession : structuredSession;
    if (parsedSession.success) initialState.session = parsedSession.data;
    const parsedCatalog = BrowseIconsOutputSchema.safeParse(structured["result"]);
    if (parsedCatalog.success) initialState.catalog = asCatalog(parsedCatalog.data);
    announceInitialState();
  };

  await app.connect();
  return new EmbeddedRuntime(app, initialState);
}
