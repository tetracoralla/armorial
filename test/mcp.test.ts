import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { test } from "node:test";
import {
  BrowseIconsOutputSchema,
  DEFAULT_POLICY,
  MAX_MCP_TOOL_CATALOG_BYTES,
} from "../src/core/contracts.js";
import { IconKernel } from "../src/core/kernel.js";
import {
  ALL_TOOL_NAMES,
  APP_ONLY_TOOL_NAMES,
  assertBoundedPickerHtml,
  createMcpServer,
  ICON_PICKER_RESOURCE_URI,
  PUBLIC_TOOL_NAMES,
} from "../src/adapters/mcp.js";

function structured(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

test("MCP exposes bounded model tools plus one app-only catalog tool", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(new IconKernel(), async () => "<!doctype html><title>Icon picker</title>");
  const client = new Client({ name: "armorial-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const listed = await client.listTools();
    const catalogBytes = Buffer.byteLength(JSON.stringify(listed), "utf8");
    assert.ok(
      catalogBytes <= MAX_MCP_TOOL_CATALOG_BYTES,
      `MCP tool catalog is ${catalogBytes} bytes; budget is ${MAX_MCP_TOOL_CATALOG_BYTES}.`,
    );
    assert.deepEqual(listed.tools.map((tool) => tool.name), [...ALL_TOOL_NAMES]);
    for (const tool of listed.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.idempotentHint, true);
      assert.equal(tool.annotations?.openWorldHint, false);
      assert.equal(tool.inputSchema.additionalProperties, false);
      if ((PUBLIC_TOOL_NAMES as readonly string[]).includes(tool.name)) {
        assert.ok(tool.outputSchema, `${tool.name} must declare an output schema`);
      }
    }
    const chooseTool = listed.tools.find((tool) => tool.name === "choose_icon");
    assert.deepEqual((chooseTool?._meta?.ui as { visibility?: string[] } | undefined)?.visibility, ["model"]);
    assert.equal((chooseTool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, ICON_PICKER_RESOURCE_URI);
    const resolveTool = listed.tools.find((tool) => tool.name === "resolve_icon");
    assert.match(resolveTool?.description ?? "", /never prose; omit when unknown/);
    assert.match(resolveTool?.description ?? "", /do not follow with get_icon/);
    const resolveProperties = resolveTool?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;
    assert.match(resolveProperties?.context?.description ?? "", /omit prose or unknown/);
    const browseTool = listed.tools.find((tool) => tool.name === APP_ONLY_TOOL_NAMES[0]);
    assert.deepEqual((browseTool?._meta?.ui as { visibility?: string[] } | undefined)?.visibility, ["app"]);
    assert.equal(browseTool?.outputSchema, undefined, "app-only catalog output must not inflate model listings");

    const resources = await client.listResources();
    assert.equal(resources.resources.some((resource) => resource.uri === ICON_PICKER_RESOURCE_URI), true);
    const picker = await client.readResource({ uri: ICON_PICKER_RESOURCE_URI });
    assert.equal(picker.contents[0]?.mimeType, "text/html;profile=mcp-app");
    assert.match((picker.contents[0] as { text?: string } | undefined)?.text ?? "", /Icon picker/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP resolve, ambiguity, validation, and batch partial failure use structured content", async () => {
  const policy = {
    ...structuredClone(DEFAULT_POLICY),
    selections: { settings: "icon-park:setting-two" },
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(new IconKernel(policy), async () => "<!doctype html>");
  const client = new Client({ name: "armorial-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const resolved = await client.callTool({
      name: "resolve_icon",
      arguments: { intent: "settings", alternatives: 2 },
    });
    assert.equal(resolved.isError, undefined);
    const resolvedContent = structured(structured(resolved.structuredContent).result);
    assert.equal(resolvedContent.status, "ok");
    assert.equal((resolvedContent.icon as { id?: string } | undefined)?.id, "icon-park:setting-two");

    const ordinaryPhrase = await client.callTool({
      name: "resolve_icon",
      arguments: { intent: "我要新增图标", alternatives: 2 },
    });
    assert.equal(ordinaryPhrase.isError, undefined);
    const ordinaryPhraseContent = structured(structured(ordinaryPhrase.structuredContent).result);
    assert.equal(ordinaryPhraseContent.status, "ok");
    assert.equal((ordinaryPhraseContent.icon as { id?: string } | undefined)?.id, "icon-park:add");

    for (const intent of ["delete settings", "添加删除"]) {
      const multiSemantic = await client.callTool({
        name: "resolve_icon",
        arguments: { intent, alternatives: 2 },
      });
      assert.equal(multiSemantic.isError, undefined, intent);
      const multiSemanticContent = structured(structured(multiSemantic.structuredContent).result);
      assert.equal(multiSemanticContent.status, "ambiguous", intent);
      assert.equal(structured(multiSemanticContent.error).code, "ICON_AMBIGUOUS", intent);
    }

    const ambiguous = await client.callTool({
      name: "resolve_icon",
      arguments: { intent: "关闭", alternatives: 2 },
    });
    assert.equal(ambiguous.isError, undefined);
    assert.equal(structured(structured(ambiguous.structuredContent).result).status, "ambiguous");

    const invalid = await client.callTool({
      name: "get_icon",
      arguments: { id: "search", invented: true },
    });
    assert.equal(invalid.isError, true);

    const batch = await client.callTool({
      name: "get_icons",
      arguments: { ids: ["search", "not-a-real-icon"] },
    });
    assert.equal(batch.isError, undefined);
    const batchContent = structured(structured(batch.structuredContent).result);
    assert.equal(batchContent.status, "ok");
    assert.deepEqual(batchContent.summary, { requested: 2, rendered: 1, failed: 1 });

    const picker = await client.callTool({
      name: "choose_icon",
      arguments: { intent: "notification", requestId: "req-42" },
    });
    assert.equal(picker.isError, undefined);
    const pickerEnvelope = structured(picker.structuredContent);
    assert.ok(
      Buffer.byteLength(JSON.stringify(pickerEnvelope), "utf8") <= MAX_MCP_TOOL_CATALOG_BYTES,
      "choose_icon model envelope must stay catalog-sized",
    );
    const pickerSummary = structured(pickerEnvelope.result);
    assert.equal(pickerSummary.status, "ok");
    assert.equal(pickerSummary.kind, "icon_picker_session");
    assert.equal(pickerSummary.intent, "notification");
    assert.equal("items" in pickerSummary, false);
    assert.equal("svg" in pickerSummary, false);
    assert.equal(structured(pickerEnvelope.session).requestId, "req-42");

    const browsePage = await client.callTool({
      name: "browse_icons",
      arguments: { query: "notification", offset: 0, limit: 8 },
    });
    assert.equal(browsePage.isError, undefined);
    const browseContent = structured(structured(browsePage.structuredContent).result);
    assert.equal(BrowseIconsOutputSchema.safeParse(browseContent).success, true);
    const browseItems = browseContent.items as Array<{ id?: string; asset?: { svg?: string } }>;
    assert.equal(browseItems[0]?.id, "icon-park:remind");
    assert.match(browseItems[0]?.asset?.svg ?? "", /<svg/);

    const invalidBrowse = await client.callTool({
      name: "browse_icons",
      arguments: { query: "notification", sourcePath: "/tmp/icon.svg" },
    });
    assert.equal(invalidBrowse.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("public tool registry distinguishes model entry points from app-only helpers", () => {
  assert.deepEqual(PUBLIC_TOOL_NAMES, ["resolve_icon", "search_icons", "get_icon", "get_icons", "choose_icon"]);
  assert.deepEqual(APP_ONLY_TOOL_NAMES, ["browse_icons"]);
});

test("MCP App HTML is bounded as a complete resource envelope", () => {
  assert.throws(
    () => assertBoundedPickerHtml("x".repeat(900 * 1024 + 1)),
    /resource exceeds/,
  );
});
