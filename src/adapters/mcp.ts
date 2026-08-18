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
  BrowseIconsOutputSchema,
  ChooseIconInputSchema,
  ChooseIconSummarySchema,
  GetIconInputSchema,
  GetIconOutputSchema,
  GetIconsInputSchema,
  GetIconsOutputSchema,
  ICON_PICKER_SESSION_META_KEY,
  KERNEL_VERSION,
  MAX_MCP_APP_RESOURCE_BYTES,
  MAX_MCP_TOOL_CATALOG_BYTES,
  MAX_UI_CATALOG_RESPONSE_BYTES,
  ResolveInputSchema,
  ResolveOutputSchema,
  SafeColorSchema,
  SearchInputSchema,
  SearchOutputSchema,
  StrokeLinecapSchema,
  StrokeLinejoinSchema,
  ThemeSchema,
} from "../core/contracts.js";
import { IconKernelError, toKernelError } from "../core/errors.js";
import { IconKernel } from "../core/kernel.js";
import { isMainModule } from "./main-module.js";
import { resolvePolicyInput } from "./policy-file.js";
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

const McpSafeColorSchema = z.string()
  .max(64)
  .superRefine((value, context) => {
    if (!SafeColorSchema.safeParse(value).success) {
      context.addIssue({ code: "custom", message: "Use a supported SVG color." });
    }
  })
  .meta({ id: "RenderColor" });

// The advertised transport schema keeps colors bounded without expanding the
// full CSS named-color set into every tool listing. The runtime refinement and
// kernel both validate the exact accepted grammar before rendering.
const RenderStyleOverrideMcpSchema = z.strictObject({
  theme: ThemeSchema.optional(),
  size: z.number().int().min(8).max(512).optional(),
  strokeWidth: z.number().min(0.5).max(16).optional(),
  strokeLinecap: StrokeLinecapSchema.optional(),
  strokeLinejoin: StrokeLinejoinSchema.optional(),
  colors: z.partialRecord(
    z.enum(["primary", "secondary", "innerStroke", "innerFill"]),
    McpSafeColorSchema,
  ).optional(),
});

const ResolveInputMcpSchema = ResolveInputSchema.extend({ render: RenderStyleOverrideMcpSchema.optional() });
const GetIconInputMcpSchema = GetIconInputSchema.extend({ render: RenderStyleOverrideMcpSchema.optional() });
const GetIconsInputMcpSchema = GetIconsInputSchema.extend({ render: RenderStyleOverrideMcpSchema.optional() });
const BrowseIconsInputMcpSchema = BrowseIconsInputSchema.extend({ render: RenderStyleOverrideMcpSchema.optional() });
const ChooseIconInputMcpSchema = ChooseIconInputSchema.extend({ render: RenderStyleOverrideMcpSchema.optional() });
const ChooseIconMcpOutputSchema = z.strictObject({ result: ChooseIconSummarySchema });

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

function assertToolResultEnvelope(name: string, envelope: unknown, limit: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (bytes > limit) {
    throw new IconKernelError({
      code: "RESPONSE_TOO_LARGE",
      message: `Tool result envelope for ${name} exceeds the ${limit}-byte limit.`,
    });
  }
}

export function createMcpServer(
  kernel: IconKernel,
  loadPickerHtml: () => Promise<string> = loadBuiltPickerHtml,
): McpServer {
  const server = new McpServer({ name: "armorial", version: KERNEL_VERSION });

  server.registerTool(
    "resolve_icon",
    {
      title: "Resolve approved icon",
      description: "Select and render one project-aware IconPark SVG for a semantic intent. Default one-call route; the result includes the asset, so do not follow with get_icon. Context is a known configured ASCII policy key, never prose; omit when unknown.",
      inputSchema: ResolveInputMcpSchema,
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
      description: "Find compact IconPark candidates by name, title, tag, alias, or category. Use only when alternatives are needed.",
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
      description: "Render a known IconPark id under project policy. Returns deterministic SVG, effective policy, capabilities, and hash.",
      inputSchema: GetIconInputMcpSchema,
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
      description: "Render up to 20 known IconPark ids under one policy/context, preserving order and per-id failures.",
      inputSchema: GetIconsInputMcpSchema,
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
      description: "Open the human picker only for visual choice, rejection, or unresolved taste. Wait for the user's icon_selection message.",
      inputSchema: ChooseIconInputMcpSchema,
      outputSchema: ChooseIconMcpOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: ICON_PICKER_RESOURCE_URI, visibility: ["model"] } },
    },
    (input) => {
      // The model only needs the session handle; the app-visible picker fetches
      // candidate pages itself through browse_icons, so no rendered SVGs enter
      // the model context from this call.
      const result = ChooseIconSummarySchema.parse({
        status: "ok" as const,
        kind: "icon_picker_session" as const,
        intent: input.intent,
        context: input.context ?? null,
        requestId: input.requestId ?? null,
        resourceUri: ICON_PICKER_RESOURCE_URI,
      });
      const envelope = {
        content: [{
          type: "text" as const,
          text: "The visual icon picker is open for the human to choose. Wait for the user's icon_selection message before continuing.",
        }],
        structuredContent: { result },
        // The app needs the exact starting style, while the model only needs
        // the compact session summary. MCP result metadata is forwarded to the
        // app without inflating model-visible structured content or schemas.
        _meta: { [ICON_PICKER_SESSION_META_KEY]: input },
      };
      assertToolResultEnvelope("choose_icon", envelope, MAX_MCP_TOOL_CATALOG_BYTES);
      return envelope;
    },
  );

  registerAppTool(
    server,
    "browse_icons",
    {
      title: "Browse icons for picker",
      description: "Load one bounded page of rendered icons for the picker.",
      inputSchema: BrowseIconsInputMcpSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: ICON_PICKER_RESOURCE_URI, visibility: ["app"] } },
    },
    (input) => {
      // This helper is visible only to the bundled app, which already owns the
      // typed catalog contract. Omitting its large advertised output schema
      // keeps that app-only contract out of every model tool listing; the
      // executable Zod validation remains at the adapter boundary.
      const output = BrowseIconsOutputSchema.parse(kernel.browse(input));
      const envelope = mcpResult(
        output as Record<string, unknown>,
        `Loaded ${output.status === "ok" ? output.items.length : 0} icon candidates.`,
        output.status === "error",
      );
      assertToolResultEnvelope("browse_icons", envelope, MAX_UI_CATALOG_RESPONSE_BYTES);
      return envelope;
    },
  );

  registerAppResource(
    server,
    "Armorial picker",
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
  const policy = await resolvePolicyInput(parsed.values.policy);
  const server = createMcpServer(new IconKernel(policy));
  await server.connect(new StdioServerTransport());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ status: "error", error: toKernelError(error) })}\n`);
    process.exitCode = 1;
  });
}
