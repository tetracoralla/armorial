import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MESSAGE_KEYS,
  SUPPORTED_LOCALES,
  isLocalePreference,
  parseStoredLocalePreference,
  resolveLocale,
  translate,
  type MessageKey,
} from "../src/ui/i18n.js";
import { FigmaLocalePreferenceSchema } from "../src/figma/protocol.js";

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => name !== "")
    .sort();
}

test("both locales cover every message key with non-empty templates", () => {
  for (const key of MESSAGE_KEYS) {
    for (const locale of SUPPORTED_LOCALES) {
      const template = translate(locale, key);
      assert.ok(template.length > 0, `${locale}:${key} is empty`);
    }
  }
});

test("placeholder names stay identical across locales", () => {
  for (const key of MESSAGE_KEYS) {
    assert.deepEqual(
      placeholders(translate("zh-CN", key)),
      placeholders(translate("en", key)),
      `${key} carries different placeholders in zh-CN`,
    );
  }
});

test("translate interpolates named values and keeps unknown placeholders", () => {
  assert.equal(translate("en", "placedIn", { name: "Vector", parent: "Cover" }), "Placed Vector in Cover");
  assert.equal(translate("zh-CN", "placedIn", { name: "Vector", parent: "封面" }), "已将 Vector 放入 封面");
  assert.equal(translate("en", "iconsCount", { count: "2,658" }), "2,658 icons");
  assert.equal(translate("zh-CN", "iconsCount", { count: "2,658" }), "2,658 个图标");
  assert.equal(translate("en", "editColor", { slot: "Primary" }), "Edit Primary color");
  // An unknown placeholder survives verbatim instead of rendering "undefined".
  assert.equal(translate("en", "placedIn", {}), "Placed {name} in {parent}");
});

test("resolveLocale maps system locale chains deterministically", () => {
  assert.equal(resolveLocale("system", ["zh-CN", "en-US"]), "zh-CN");
  assert.equal(resolveLocale("system", ["zh_Hans_CN"]), "zh-CN");
  assert.equal(resolveLocale("system", ["zh-SG"]), "zh-CN");
  assert.equal(resolveLocale("system", ["zh-TW", "en"]), "en");
  assert.equal(resolveLocale("system", ["en-GB"]), "en");
  assert.equal(resolveLocale("system", ["fr-FR"]), "en");
  assert.equal(resolveLocale("system", []), "en");
  assert.equal(resolveLocale("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveLocale("en", ["zh-CN"]), "en");
});

test("stored locale preferences parse defensively", () => {
  assert.equal(parseStoredLocalePreference({ version: 1, locale: "zh-CN" }), "zh-CN");
  assert.equal(parseStoredLocalePreference({ version: 1, locale: "system" }), "system");
  assert.equal(parseStoredLocalePreference({ version: 2, locale: "zh-CN" }), "system");
  assert.equal(parseStoredLocalePreference({ version: 1, locale: "zh-TW" }), "system");
  assert.equal(parseStoredLocalePreference(null), "system");
  assert.equal(parseStoredLocalePreference("system"), "system");
  assert.equal(isLocalePreference("en"), true);
  assert.equal(isLocalePreference("zh-TW"), false);
});

test("the Figma protocol locale enum matches the UI locale preference union", () => {
  // protocol.ts repeats the literals so the plugin main bundle does not pull
  // the message dictionaries; this lock keeps the two definitions from
  // drifting apart silently.
  const protocolValues = [...FigmaLocalePreferenceSchema.options].sort();
  const uiValues = ["system", ...SUPPORTED_LOCALES].sort();
  assert.deepEqual(protocolValues, uiValues);
});

test("representative keys exist for both surfaces", () => {
  for (const key of ["insertComponent", "copyForAgent", "appearance", "capButt", "joinBevel", "language"] as MessageKey[]) {
    assert.ok(MESSAGE_KEYS.includes(key), key);
  }
});
