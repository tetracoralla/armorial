import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getQuickJS } from "quickjs-emscripten";

// Figma's plugin main thread runs on a QuickJS engine, not V8. This smoke
// probe executes the built main.js inside an actual QuickJS VM with a minimal
// `figma` host so "the plugin environment failed to load" class regressions
// (unsupported syntax, missing globals, top-level throws) surface in `npm run
// check` instead of only in Figma Desktop.
const projectRoot = resolve(import.meta.dirname, "..");
const [mainCode, uiHtml] = await Promise.all([
  readFile(resolve(projectRoot, "figma-plugin/dist/main.js"), "utf8"),
  readFile(resolve(projectRoot, "figma-plugin/dist/ui.html"), "utf8"),
]);

const QuickJS = await getQuickJS();
const runtime = QuickJS.newRuntime();
const vm = runtime.newContext();
// Handles are intentionally not disposed: the probe process exits right after
// its assertions, and exhaustive disposal bookkeeping would only obscure the
// smoke-test body.

const calls = { showUI: [], on: [], postMessage: [], resize: [] };
const promiseOf = vm.unwrapResult(vm.evalCode("((value) => Promise.resolve(value))"));

function hostPromise(valueHandle) {
  return vm.unwrapResult(vm.callFunction(promiseOf, vm.undefined, valueHandle));
}

const clientStorage = vm.newObject();
vm.setProp(clientStorage, "getAsync", vm.newFunction("getAsync", () => hostPromise(vm.null)));
vm.setProp(clientStorage, "setAsync", vm.newFunction("setAsync", () => hostPromise(vm.undefined)));
vm.setProp(clientStorage, "deleteAsync", vm.newFunction("deleteAsync", () => hostPromise(vm.undefined)));
vm.setProp(clientStorage, "keysAsync", vm.newFunction("keysAsync", () => hostPromise(vm.newArray())));

const currentPage = vm.newObject();
vm.setProp(currentPage, "name", vm.newString("Probe Page"));

const ui = vm.newObject();
vm.setProp(ui, "postMessage", vm.newFunction("postMessage", (message) => {
  calls.postMessage.push(vm.dump(message));
  return vm.undefined;
}));
vm.setProp(ui, "resize", vm.newFunction("resize", (width, height) => {
  calls.resize.push([vm.dump(width), vm.dump(height)]);
  return vm.undefined;
}));
vm.setProp(ui, "on", vm.newFunction("on", () => vm.undefined));

const figma = vm.newObject();
vm.setProp(figma, "clientStorage", clientStorage);
vm.setProp(figma, "currentPage", currentPage);
vm.setProp(figma, "ui", ui);
vm.setProp(figma, "showUI", vm.newFunction("showUI", (html, options) => {
  calls.showUI.push({ html: vm.dump(html), options: vm.dump(options) });
  return vm.undefined;
}));
vm.setProp(figma, "on", vm.newFunction("on", (event) => {
  calls.on.push(vm.dump(event));
  return vm.undefined;
}));

vm.setProp(vm.global, "figma", figma);
// Figma injects the ui file's content as the __html__ global; feeding the real
// built ui.html keeps the smoke run faithful to the shipped artifact.
vm.setProp(vm.global, "__html__", vm.newString(uiHtml));
for (const constructorName of ["HTMLIFrameElement", "HTMLElement"]) {
  vm.setProp(vm.global, constructorName, vm.newFunction(constructorName, () => vm.undefined));
}

const evaluation = vm.evalCode(mainCode);
// quickjs-emscripten marks failure with `error: true`; a successful eval has
// no `error` property at all.
assert.notEqual(evaluation.error, true, "main.js must evaluate without a QuickJS syntax or reference error");
if (evaluation.error === true) {
  throw new Error(`main.js failed to load in QuickJS: ${JSON.stringify(vm.dump(evaluation.value))}`);
}
vm.unwrapResult(evaluation).dispose();
runtime.executePendingJobs();

assert.equal(calls.showUI.length, 1, "the plugin must call figma.showUI exactly once");
const [showUI] = calls.showUI;
assert.equal(showUI.html, uiHtml, "figma.showUI must receive the built ui.html via __html__");
assert.equal(showUI.options.title, "Armorial");
assert.equal(showUI.options.width, 1160);
assert.equal(showUI.options.height, 760);
assert.deepEqual(calls.on, ["drop", "currentpagechange"]);

const stateMessage = calls.postMessage.find((message) => message?.type === "state");
assert.ok(stateMessage !== undefined, "the plugin must announce its state to the UI after startup");
assert.equal(stateMessage.pageName, "Probe Page");
assert.equal(stateMessage.locale, "system");
assert.equal(typeof stateMessage.settings.createComponent, "boolean");

console.log("Figma main QuickJS smoke passed (showUI, drop, currentpagechange, state).");
