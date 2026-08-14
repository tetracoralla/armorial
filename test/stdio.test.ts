import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("real stdio MCP process lists and executes the policy-pinned dominant route", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/adapters/mcp.ts", "--policy", "icon-policy.example.json"],
    cwd: workspace,
    stderr: "pipe",
  });
  const client = new Client({ name: "icon-svg-select-stdio-test", version: "1.0.0" });
  await client.connect(transport);

  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), [
      "resolve_icon",
      "search_icons",
      "get_icon",
      "get_icons",
      "choose_icon",
      "browse_icons",
    ]);

    const result = await client.callTool({
      name: "resolve_icon",
      arguments: { intent: "设置", context: "toolbar", alternatives: 2 },
    });
    assert.equal(result.isError, undefined);
    const envelope = result.structuredContent as { result?: { status?: string; icon?: { id?: string } } } | undefined;
    assert.equal(envelope?.result?.status, "ok");
    assert.equal(envelope?.result?.icon?.id, "icon-park:setting-two");
  } finally {
    await client.close();
  }
});
