import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { IconKernel } from "../src/core/kernel.js";
import { DEFAULT_POLICY, MAX_SELECTION_RESPONSE_BYTES, SelectIconsOutputSchema } from "../src/core/contracts.js";
import { createMcpServer } from "../src/adapters/mcp.js";

test("selection does not render and preserves policy, duplicates, and every unresolved meaning", () => {
  const kernel = new IconKernel({ ...structuredClone(DEFAULT_POLICY), selections: { settings: "icon-park:setting-two" } });
  kernel.provider.render = () => { throw new Error("Selection must not render"); };
  const output = kernel.selectIcons({ intents: ["search", "settings", "关闭", "zzzznoicon", "search"], render: { size: 32 } });
  assert.equal(output.status, "partial");
  assert.deepEqual(output.summary, { requested: 5, resolved: 3, unresolved: 2, uniqueIcons: 2 });
  assert.deepEqual(output.items.map((item) => item.index), [0, 1, 2, 3, 4]);
  assert.equal(output.items[1]?.status, "ok");
  if (output.items[1]?.status === "ok") {
    assert.equal(output.items[1].id, "icon-park:setting-two");
    assert.equal(output.items[1].selectionMethod, "policy");
  }
  assert.equal(output.items[2]?.status, "ambiguous");
  assert.equal(output.items[3]?.status, "error");
  assert.equal(output.policy.size, 32);
  assert.equal(output.policyCompliance, "overridden");
  assert.doesNotMatch(JSON.stringify(output), /<svg|"asset"/);
});

test("all exact catalog ids are selectable without rendering or building a semantic index", () => {
  const kernel = new IconKernel();
  kernel.provider.render = () => { throw new Error("Selection must not render"); };
  const ids = kernel.provider.records.map((record) => record.canonicalId);
  for (let start = 0; start < ids.length; start += 20) {
    const inputs = ids.slice(start, start + 20);
    const output = kernel.selectIcons({ intents: inputs });
    assert.equal(output.status, "ok");
    if (output.status !== "ok") throw new Error("Selection failed");
    assert.deepEqual(output.items.map((item) => item.status === "ok" ? item.id : null), inputs);
  }
  assert.equal(kernel.searchIndex, undefined);
});

test("selection and rendering use the same decision and validate inputs before work", () => {
  const kernel = new IconKernel();
  for (const intent of ["search", "settings", "notification", "close", "设置", "关闭", "delete settings", "zzzz"]) {
    const selected = kernel.selectIcons({ intents: [intent] });
    const rendered = kernel.resolve({ intent, alternatives: 0 });
    if (selected.status === "error") throw new Error(selected.error.message);
    assert.equal(selected.items[0]?.status, rendered.status);
    if (selected.items[0]?.status === "ok" && rendered.status === "ok") assert.equal(selected.items[0].id, rendered.icon.id);
  }
  for (const input of [{ intents: [] }, { intents: Array(21).fill("search") }, { intents: ["x".repeat(121)] },
    { intents: ["search"], render: { strokeWidth: 2.5 } }, { intents: ["search"], extra: true }]) {
    assert.equal(kernel.selectIcons(input as never).status, "error");
  }
});

test("MCP selects 20 meanings with compact partial results and closed inputs", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(new IconKernel());
  const client = new Client({ name: "selection-test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "select_icons", arguments: { intents: [...Array(19).fill("search"), "关闭"] } });
    assert.notEqual(result.isError, true);
    const output = SelectIconsOutputSchema.parse((result.structuredContent as { result: unknown }).result);
    assert.equal(output.status, "partial");
    assert.ok(JSON.stringify(result).length < 8000);
    assert.doesNotMatch(JSON.stringify(result), /<svg|"asset"/);
    assert.equal((await client.callTool({ name: "select_icons", arguments: { intents: Array(21).fill("search") } })).isError, true);
  } finally { await client.close(); await server.close(); }
});

test("selection and render preserve color canonicalization and compliance", () => {
  const kernel = new IconKernel();
  const render = { colors: { primary: "CURRENTCOLOR" } };
  const selected = kernel.selectIcons({ intents: ["search"], render });
  const resolved = kernel.resolve({ intent: "search", alternatives: 0, render });
  const exact = kernel.getIcon({ id: "icon-park:search", render });
  assert.equal(selected.status, "ok");
  assert.equal(resolved.status, "ok");
  assert.equal(exact.status, "ok");
  if (selected.status !== "ok" || resolved.status !== "ok" || exact.status !== "ok") return;
  assert.equal(selected.policyCompliance, "compliant");
  assert.equal(resolved.icon.policyCompliance, "compliant");
  assert.deepEqual(selected.policy, exact.icon.policy);
  assert.equal(resolved.icon.asset.sha256, exact.icon.asset.sha256);
});

test("oversized selection metadata closes as a structured failure through MCP", async () => {
  const kernel = new IconKernel();
  const get = kernel.provider.get.bind(kernel.provider);
  // Model future provider metadata growth without mutating the pinned corpus.
  kernel.provider.get = (id) => {
    const record = get(id);
    return record === undefined ? undefined : { ...record, title: "界".repeat(MAX_SELECTION_RESPONSE_BYTES / 2) };
  };
  const direct = kernel.selectIcons({ intents: ["icon-park:search"] });
  assert.equal(direct.status, "error");
  if (direct.status !== "error") throw new Error("Expected bounded failure");
  assert.equal(direct.error.code, "RESPONSE_TOO_LARGE");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(kernel);
  const client = new Client({ name: "selection-budget-test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "select_icons", arguments: { intents: ["icon-park:search"] } });
    assert.equal(result.isError, true);
    assert.deepEqual((result.structuredContent as { result: unknown }).result, direct);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024);
  } finally { await client.close(); await server.close(); }
});
