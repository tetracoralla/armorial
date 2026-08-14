#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  BrowseIconsInputSchema,
  ChooseIconInputSchema,
  DEFAULT_POLICY,
  GetIconInputSchema,
  GetIconOutputSchema,
  GetIconsInputSchema,
  GetIconsOutputSchema,
  KERNEL_VERSION,
  MAX_MCP_APP_RESOURCE_BYTES,
  ResolveInputSchema,
  ResolveOutputSchema,
  SearchInputSchema,
  SearchOutputSchema,
} from "../core/contracts.js";
import { IconKernelError, toKernelError } from "../core/errors.js";
import { IconKernel } from "../core/kernel.js";
import { isMainModule } from "./main-module.js";
import { loadPolicyFile } from "./policy-file.js";
import { presentBatch, presentGet, presentResolve, presentSearch } from "./presentation.js";

export const ICON_PICKER_RESOURCE_URI = "ui://icon-svg-select/picker.html";
export const PUBLIC_TOOL_NAMES = ["resolve_icon", "search_icons", "get_icon", "get_icons", "choose_icon"] as const;
export const APP_ONLY_TOOL_NAMES = ["browse_icons"] as const;
export const ALL_TOOL_NAMES = [...PUBLIC_TOOL_NAMES, ...APP_ONLY_TOOL_NAMES] as const;

export function assertBoundedPickerHtml(html: string): string {
  if (Buffer.byteLength(html, "utf8") > MAX_MCP_APP_RESOURCE_BYTES) {
    throw new IconKernelError({
      code: "RESPONSE_TOO_LARGE",
      message: `MCP App resource exceeds the ${MAX_MCP_APP_RESOURCE_BYTES}-byte limit.`,
    });
  }
  return html;
}

async function loadBuiltPickerHtml(): Promise<string> {
  return assertBoundedPickerHtml(await readFile(resolve(import.meta.dirname, "../mcp-app/index.html"), "utf8"));
}

const ResolveMcpOutputSchema = z.strictObject({ result: ResolveOutputSchema });
const SearchMcpOutputSchema = z.strictObject({ result: SearchOutputSchema });
const GetIconMcpOutputSchema = z.strictObject({ result: GetIconOutputSchema });
const GetIconsMcpOutputSchema = z.strictObject({ result: GetIconsOutputSchema });

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function mcpResult(
  output: Record<string, unknown>,
  presentation: string,
  isError = false,
) {
  return {
    content: [{ type: "text" as const, text: presentation }],
    structuredContent: { result: output },
    ...(isError ? { isError: true } : {}),
  };
}

export function createMcpServer(
  kernel: IconKernel,
  loadPickerHtml: () => Promise<string> = loadBuiltPickerHtml,
): McpServer {
  const server = new McpServer({ name: "icon-svg-select", version: KERNEL_VERSION });

  server.registerTool(
    "resolve_icon",
    {
      title: "Resolve approved icon",
      description: "Choose and render one policy-compliant IconPark SVG from a semantic intent such as settings, search, 设置, or 搜索. Use this as the one-call default instead of drawing SVG.",
      inputSchema: ResolveInputSchema,
      outputSchema: ResolveMcpOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => {
      const output = kernel.resolve(input);
      return mcpResult(output as Record<string, unknown>, presentResolve(output), output.status === "error");
    },
  );

  server.registerTool(
    "search_icons",
    {
      title: "Search approved icons",
      description: "Find compact IconPark candidates by English or Chinese name, title, tag, alias, or category. Use when alternatives are needed before choosing an exact id.",
      inputSchema: SearchInputSchema,
      outputSchema: SearchMcpOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => {
      const output = kernel.search(input);
      return mcpResult(output as Record<string, unknown>, presentSearch(output), output.status === "error");
    },
  );

  server.registerTool(
    "get_icon",
    {
      title: "Render exact approved icon",
      description: "Render a known IconPark id with the server's project policy and optional context. Returns deterministic SVG, effective policy, capability, policy compliance, license, and hash.",
      inputSchema: GetIconInputSchema,
      outputSchema: GetIconMcpOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => {
      const output = kernel.getIcon(input);
      return mcpResult(output as Record<string, unknown>, presentGet(output), output.status === "error");
    },
  );

  server.registerTool(
    "get_icons",
    {
      title: "Render approved icon batch",
      description: "Render up to 20 known IconPark ids with one policy and context. Preserves input order and reports each failed id without hiding successful items.",
      inputSchema: GetIconsInputSchema,
      outputSchema: GetIconsMcpOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => {
      const output = kernel.getIcons(input);
      return mcpResult(output as Record<string, unknown>, presentBatch(output), output.status === "error");
    },
  );

  registerAppTool(
    server,
    "choose_icon",
    {
      title: "Open visual icon picker",
      description: "Open the human icon picker when the user asks to choose visually, rejects a prior icon, or an exact visual decision is required. Wait for the user's icon_selection message before continuing.",
      inputSchema: ChooseIconInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: ICON_PICKER_RESOURCE_URI, visibility: ["model"] } },
    },
    (input) => {
      const result = kernel.browse({
        query: input.intent,
        ...(input.context === undefined ? {} : { context: input.context }),
        offset: 0,
        limit: 60,
      });
      return {
        content: [{ type: "text" as const, text: "The visual icon picker is open. Wait for the user's explicit icon_selection message before continuing." }],
        structuredContent: { result, session: input },
        ...(result.status === "error" ? { isError: true as const } : {}),
      };
    },
  );

  registerAppTool(
    server,
    "browse_icons",
    {
      title: "Browse icons for picker",
      description: "Load one bounded page of policy-rendered icons for the interactive picker.",
      inputSchema: BrowseIconsInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: ICON_PICKER_RESOURCE_URI, visibility: ["app"] } },
    },
    (input) => {
      const output = kernel.browse(input);
      return mcpResult(output as Record<string, unknown>, `Loaded ${output.status === "ok" ? output.items.length : 0} icon candidates.`, output.status === "error");
    },
  );

  registerAppResource(
    server,
    "Icon SVG Select picker",
    ICON_PICKER_RESOURCE_URI,
    {
      description: "Local-first visual icon selection workbench.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: { permissions: { clipboardWrite: {} } } },
    },
    async () => ({
      contents: [{
        uri: ICON_PICKER_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: assertBoundedPickerHtml(await loadPickerHtml()),
        _meta: { ui: { permissions: { clipboardWrite: {} } } },
      }],
    }),
  );

  return server;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      policy: { type: "string" },
    },
  });
  const policy = parsed.values.policy === undefined ? DEFAULT_POLICY : await loadPolicyFile(parsed.values.policy);
  const server = createMcpServer(new IconKernel(policy));
  await server.connect(new StdioServerTransport());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ status: "error", error: toKernelError(error) })}\n`);
    process.exitCode = 1;
  });
}
