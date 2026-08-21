import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FIGMA_PLUGIN_SETTINGS } from "../src/figma/protocol.js";
import { FigmaSettingsStore } from "../src/figma/settings-store.js";

test("concurrent Figma setting updates preserve both appearance and insertion fields", async () => {
  let stored: unknown = DEFAULT_FIGMA_PLUGIN_SETTINGS;
  const writes: unknown[] = [];
  const store = new FigmaSettingsStore({
    async getAsync() {
      return stored;
    },
    async setAsync(_key, value) {
      await Promise.resolve();
      stored = value;
      writes.push(value);
    },
  }, "settings");

  await Promise.all([
    store.update((current) => ({
      ...current,
      insert: { ...current.insert, layerStructure: "flatten", createComponent: false },
    })),
    store.update((current) => ({
      ...current,
      render: { size: 40, strokeLinecap: "square" },
    })),
  ]);

  assert.equal(writes.length, 2);
  assert.deepEqual(await store.load(), {
    version: 2,
    insert: {
      ...DEFAULT_FIGMA_PLUGIN_SETTINGS.insert,
      layerStructure: "flatten",
      createComponent: false,
    },
    render: { size: 40, strokeLinecap: "square" },
  });
  assert.deepEqual(stored, await store.load());
});

test("Figma settings remain usable in memory when client storage is unavailable", async () => {
  const store = new FigmaSettingsStore({
    async getAsync() {
      throw new Error("storage unavailable");
    },
    async setAsync() {
      throw new Error("storage unavailable");
    },
  }, "settings");

  await store.update((current) => ({
    ...current,
    render: { theme: "filled" },
  }));
  assert.deepEqual((await store.load()).render, { theme: "filled" });
});

test("legacy Figma stroke pixels migrate once to the bounded IconPark 1-4 scale", async () => {
  const legacyInsert = {
    ...DEFAULT_FIGMA_PLUGIN_SETTINGS.insert,
    createComponent: false,
  };
  for (const [legacyStroke, expectedWeight] of [[0.5, 1], [1.5, 3], [2, 4], [3.5, 4]] as const) {
    let stored: unknown = {
      insert: legacyInsert,
      render: { size: 32, strokeWidth: legacyStroke, strokeLinecap: "square" },
    };
    const writes: unknown[] = [];
    const storage = {
      async getAsync() {
        return stored;
      },
      async setAsync(_key: string, value: unknown) {
        stored = value;
        writes.push(value);
      },
    };
    const store = new FigmaSettingsStore(storage, "settings");

    const expected = {
      version: 2,
      insert: legacyInsert,
      render: { size: 32, strokeWidth: expectedWeight, strokeLinecap: "square" },
    };
    assert.deepEqual(await store.load(), expected);
    assert.deepEqual(writes, [expected]);

    const reopened = new FigmaSettingsStore(storage, "settings");
    assert.deepEqual(await reopened.load(), expected);
    assert.equal(writes.length, 1, "current settings must not be migrated again");
  }
});
