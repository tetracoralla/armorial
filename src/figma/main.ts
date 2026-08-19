import {
  FigmaDropMetadataSchema,
  FigmaInsertRequestSchema,
  FigmaUiMessageSchema,
  type FigmaMainMessage,
  type FigmaPluginSettings,
} from "./protocol.js";
import { insertIconIntoFigma } from "./insert.js";
import { FigmaSettingsStore } from "./settings-store.js";

declare const __html__: string;

const SETTINGS_KEY = "armorial/figma-settings/v1";
const settingsStore = new FigmaSettingsStore(figma.clientStorage, SETTINGS_KEY);

function post(message: FigmaMainMessage): void {
  figma.ui.postMessage(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The Figma operation did not complete.";
}

async function announceState(knownSettings?: FigmaPluginSettings): Promise<void> {
  const settings = knownSettings ?? await settingsStore.load();
  post({
    type: "state",
    settings: settings.insert,
    render: settings.render,
    pageName: figma.currentPage.name,
  });
}

figma.showUI(__html__, {
  width: 980,
  height: 720,
  title: "Armorial",
  themeColors: true,
});

figma.ui.onmessage = async (input: unknown) => {
  const parsed = FigmaUiMessageSchema.safeParse(input);
  if (!parsed.success) {
    post({ type: "operation-error", requestId: null, message: "The plugin received an invalid request." });
    return;
  }

  try {
    if (parsed.data.type === "request-state") {
      await announceState();
      return;
    }
    if (parsed.data.type === "save-settings") {
      const insert = parsed.data.settings;
      const settings = await settingsStore.update((current) => ({
        ...current,
        insert,
      }));
      await announceState(settings);
      return;
    }
    if (parsed.data.type === "save-render") {
      const render = parsed.data.render;
      const settings = await settingsStore.update((current) => ({
        ...current,
        render,
      }));
      await announceState(settings);
      return;
    }
    if (parsed.data.type === "resize-ui") {
      figma.ui.resize(
        parsed.data.mode === "compact" ? 520 : 980,
        parsed.data.mode === "compact" ? 560 : 720,
      );
      return;
    }

    const receipt = insertIconIntoFigma(figma, parsed.data, { kind: "click" });
    post({ type: "insert-result", receipt });
  } catch (error) {
    const requestId = typeof input === "object" && input !== null && "requestId" in input
      ? String(input.requestId)
      : null;
    post({ type: "operation-error", requestId, message: errorMessage(error) });
  }
};

figma.on("drop", (event) => {
  const item = event.items.find((candidate) => candidate.type === "image/svg+xml");
  const metadata = FigmaDropMetadataSchema.safeParse(event.dropMetadata);
  if (item === undefined || !metadata.success) return true;

  try {
    const request = FigmaInsertRequestSchema.parse({
      type: "insert-icon",
      requestId: metadata.data.requestId,
      asset: { ...metadata.data.asset, svg: item.data },
      settings: metadata.data.settings,
    });
    const receipt = insertIconIntoFigma(figma, request, {
      kind: "drop",
      target: event.node,
      x: event.x,
      y: event.y,
      absoluteX: event.absoluteX,
      absoluteY: event.absoluteY,
    });
    post({ type: "insert-result", receipt });
  } catch (error) {
    post({ type: "operation-error", requestId: metadata.data.requestId, message: errorMessage(error) });
  }
  return false;
});

figma.on("currentpagechange", () => {
  void announceState();
});

void announceState().catch((error) => {
  post({ type: "operation-error", requestId: null, message: errorMessage(error) });
});
