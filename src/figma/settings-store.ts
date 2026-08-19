import {
  DEFAULT_FIGMA_PLUGIN_SETTINGS,
  FigmaInsertSettingsSchema,
  FigmaPluginSettingsSchema,
  type FigmaPluginSettings,
} from "./protocol.js";

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

    // Migrate the first development build, which stored insertion settings
    // directly under the same key.
    const legacy = FigmaInsertSettingsSchema.safeParse(stored);
    return legacy.success
      ? { insert: legacy.data, render: null }
      : DEFAULT_FIGMA_PLUGIN_SETTINGS;
  }
}
