import { z } from "zod";
import {
  FigmaDropMetadataSchema,
  FigmaInsertRequestSchema,
  FigmaLocalePreferenceSchema,
  FigmaUiMessageSchema,
  type FigmaLocalePreference,
  type FigmaMainMessage,
  type FigmaPluginSettings,
} from "./protocol.js";
import { insertIconIntoFigma } from "./insert.js";
import { FigmaSettingsStore } from "./settings-store.js";

declare const __html__: string;

const SETTINGS_KEY = "armorial/figma-settings/v1";
const LOCALE_KEY = "armorial/figma-locale/v1";
const settingsStore = new FigmaSettingsStore(figma.clientStorage, SETTINGS_KEY);

const StoredLocaleSchema = z.strictObject({ version: z.literal(1), locale: FigmaLocalePreferenceSchema });

// The locale preference is intentionally its own clientStorage record: it must
// not force a version bump of the insertion-settings document.
let cachedLocale: FigmaLocalePreference = "system";
let localeLoad: Promise<FigmaLocalePreference> | null = null;

function loadLocale(): Promise<FigmaLocalePreference> {
  localeLoad ??= (async () => {
    try {
      const stored = await figma.clientStorage.getAsync(LOCALE_KEY);
      const parsed = StoredLocaleSchema.safeParse(stored);
      if (parsed.success) cachedLocale = parsed.data.locale;
    } catch {
      // An unassigned development-plugin id has no persistent namespace; the
      // system default keeps the session usable.
    }
    return cachedLocale;
  })();
  return localeLoad;
}

async function saveLocale(locale: FigmaLocalePreference): Promise<FigmaLocalePreference> {
  cachedLocale = locale;
  localeLoad = Promise.resolve(locale);
  try {
    await figma.clientStorage.setAsync(LOCALE_KEY, { version: 1, locale });
  } catch {
    // Same development-session story as loadLocale().
  }
  return cachedLocale;
}

function post(message: FigmaMainMessage): void {
  figma.ui.postMessage(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The Figma operation did not complete.";
}

async function announceState(known?: {
  settings?: FigmaPluginSettings;
  locale?: FigmaLocalePreference;
}): Promise<void> {
  const settings = known?.settings ?? await settingsStore.load();
  const locale = known?.locale ?? await loadLocale();
  post({
    type: "state",
    settings: settings.insert,
    render: settings.render,
    locale,
    pageName: figma.currentPage.name,
  });
}

figma.showUI(__html__, {
  width: 1160,
  height: 760,
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
      await announceState({ settings });
      return;
    }
    if (parsed.data.type === "save-render") {
      const render = parsed.data.render;
      const settings = await settingsStore.update((current) => ({
        ...current,
        render,
      }));
      await announceState({ settings });
      return;
    }
    if (parsed.data.type === "save-locale") {
      const locale = await saveLocale(parsed.data.locale);
      await announceState({ locale });
      return;
    }
    if (parsed.data.type === "resize-ui") {
      figma.ui.resize(
        parsed.data.mode === "compact" ? 520 : 1160,
        parsed.data.mode === "compact" ? 560 : 760,
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
  if (item === undefined || !metadata.success) {
    // Never fall back to Figma's default SVG import: it would silently place
    // an untracked plain Frame with none of the plugin's output settings.
    // Reject the drop visibly instead.
    post({
      type: "operation-error",
      requestId: metadata.success ? metadata.data.requestId : null,
      message: "The dropped icon was not recognized. Drag it from the Armorial picker again.",
    });
    return false;
  }

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
