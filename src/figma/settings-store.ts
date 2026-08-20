import { z } from "zod";
import {
  ColorPaletteSchema,
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  StrokeLinecapSchema,
  StrokeLinejoinSchema,
  ThemeSchema,
  type RenderStyleOverride,
} from "../core/contracts.js";
import {
  DEFAULT_FIGMA_PLUGIN_SETTINGS,
  FigmaInsertSettingsSchema,
  FigmaPluginSettingsSchema,
  type FigmaPluginSettings,
} from "./protocol.js";

// The first Figma build stored final rendered-pixel widths (0.5-16) without a
// settings version. Current settings use IconPark's integer 1-4 weight scale.
const LegacyRenderStyleOverrideSchema = z.strictObject({
  theme: ThemeSchema.optional(),
  size: z.number().int().min(8).max(512).optional(),
  strokeWidth: z.number().min(0.5).max(16).optional(),
  strokeLinecap: StrokeLinecapSchema.optional(),
  strokeLinejoin: StrokeLinejoinSchema.optional(),
  colors: ColorPaletteSchema.partial().optional(),
});

const LegacyFigmaPluginSettingsSchema = z.strictObject({
  insert: FigmaInsertSettingsSchema,
  render: LegacyRenderStyleOverrideSchema.nullable(),
});

function migrateLegacyRender(
  render: z.infer<typeof LegacyRenderStyleOverrideSchema> | null,
): RenderStyleOverride | null {
  if (render === null || render.strokeWidth === undefined) return render;
  const strokeWidth = Math.min(
    MAX_STROKE_WIDTH,
    Math.max(MIN_STROKE_WIDTH, Math.round(render.strokeWidth * 2)),
  );
  return { ...render, strokeWidth };
}

type AsyncSettingsStorage = {
  getAsync(key: string): Promise<unknown>;
  setAsync(key: string, value: unknown): Promise<void>;
};

type SettingsUpdate = (current: FigmaPluginSettings) => FigmaPluginSettings;

export class FigmaSettingsStore {
  readonly #storage: AsyncSettingsStorage;
  readonly #key: string;
  #loadPromise: Promise<FigmaPluginSettings> | null = null;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(storage: AsyncSettingsStorage, key: string) {
    this.#storage = storage;
    this.#key = key;
  }

  load(): Promise<FigmaPluginSettings> {
    this.#loadPromise ??= this.#read();
    return this.#loadPromise;
  }

  update(update: SettingsUpdate): Promise<FigmaPluginSettings> {
    const run = async () => {
      const current = await this.load();
      const next = FigmaPluginSettingsSchema.parse(update(current));
      this.#loadPromise = Promise.resolve(next);
      try {
        await this.#storage.setAsync(this.#key, next);
      } catch {
        // A manifest imported before Figma assigns an id has no persistent
        // storage namespace. Keep that development session usable in memory.
      }
      return next;
    };
    const result = this.#mutationTail.then(run, run);
    this.#mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #read(): Promise<FigmaPluginSettings> {
    let stored: unknown;
    try {
      stored = await this.#storage.getAsync(this.#key);
    } catch {
      return DEFAULT_FIGMA_PLUGIN_SETTINGS;
    }

    const parsed = FigmaPluginSettingsSchema.safeParse(stored);
    if (parsed.success) return parsed.data;

    const legacyPlugin = LegacyFigmaPluginSettingsSchema.safeParse(stored);
    if (legacyPlugin.success) {
      const migrated = {
        version: 2,
        insert: legacyPlugin.data.insert,
        render: migrateLegacyRender(legacyPlugin.data.render),
      } as const;
      await this.#persistMigration(migrated);
      return migrated;
    }

    // Migrate the first development build, which stored insertion settings
    // directly under the same key.
    const legacy = FigmaInsertSettingsSchema.safeParse(stored);
    if (!legacy.success) return DEFAULT_FIGMA_PLUGIN_SETTINGS;

    const migrated = { version: 2, insert: legacy.data, render: null } as const;
    await this.#persistMigration(migrated);
    return migrated;
  }

  async #persistMigration(settings: FigmaPluginSettings): Promise<void> {
    try {
      await this.#storage.setAsync(this.#key, settings);
    } catch {
      // Match update(): an unassigned development-plugin id has no persistent
      // namespace, but the migrated in-memory settings remain usable.
    }
  }
}
