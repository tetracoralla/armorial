# Icon SVG Select

Icon SVG Select is a local-first, design-system-aware icon workbench and deterministic service. It retrieves existing IconPark geometry, applies one executable project policy, and gives humans and AI Agents the same result through a web UI, library, CLI, or MCP server.

It does not ask a model to draw SVG. It also does not pretend arbitrary filled icon libraries can be normalized by changing `stroke-width`.

## What is working

- Validated local index over all 2,658 icons in `@icon-park/svg@1.4.2`.
- English and Simplified Chinese search across names, titles, categories, tags, plurals, and compact UI aliases.
- Project policy for theme, size, stroke width, cap, join, colors, per-surface overrides, and semantic icon selections.
- Explicit ambiguity when equal semantic candidates are not pinned by policy.
- Deterministic SVG, including stable internal clip-path ids, exact per-icon viewBox, byte count, hash, license, capability, and executable-policy compliance fields.
- Standalone visual workbench with browse/search, preview, Copy SVG, download, and standards-based outward drag.
- Optional MCP App picker with explicit Attach and Select & continue actions; ordinary human use never requires an Agent.
- Five model-facing MCP tools: `resolve_icon`, `search_icons`, `get_icon`, `get_icons`, and the explicit visual-decision route `choose_icon`.
- One app-only `browse_icons` helper, hidden from the model by MCP App visibility metadata.
- CLI equivalents for human inspection and shell composition.
- Strict input/output schemas, bounded queries and batches, safe color grammar, bounded SVG/response sizes, and per-item batch failures.
- A deterministic, bounded `icon_selection` decision format for copy-to-chat and connected continuation. It contains no raw SVG or arbitrary instructions.

The [product model](./docs/PRODUCT_MODEL.md) records the user flows and one-call Agent route budget. The [review contract](./docs/REVIEW_CONTRACT.md) records the current adversarial sequences.

## Install and verify

```sh
npm install
npm run check
```

`npm run check` runs type checks, negative/core/CLI/MCP tests, policy-schema drift detection, the production build, and a fresh-process probe of the built CLI and stdio MCP server.

Run the browser regression lane separately after installing the Playwright-managed Chromium version declared by this project:

```sh
npx playwright install chromium
npm run ui:e2e
```

`npm run ui:e2e` rebuilds the Node server, standalone UI, and MCP App resource before launching the browser, so it never validates stale `dist` output.

## Visual workbench

Build and launch the loopback-only local UI:

```sh
npm run build
npm run start:ui
```

Open `http://127.0.0.1:4178`. Search or browse, select one icon, then:

- **Copy SVG** copies raw SVG for direct use in any editor that accepts it.
- **Download** saves an `.svg` file.
- drag an icon cell outward; the app supplies `image/svg+xml`, plain SVG text, and a download transfer. Whether a destination accepts a browser drag is controlled by that destination, so copy and download are the guaranteed carriers.
- **Copy for Agent** copies a compact `[icon-selection:v1]` decision, not the SVG. Paste it into an Agent conversation to preserve the exact id and policy-rendered asset hash.

The right inspector reports the effective project policy. It is intentionally not a second policy editor: a human and Agent must be able to reproduce the same selected asset.

## CLI

```sh
# Compact candidate list
node dist/adapters/cli.js search settings --limit 5

# Structured resolution using the example project policy
node dist/adapters/cli.js resolve 设置 \
  --policy icon-policy.example.json \
  --context toolbar

# Pure SVG on stdout
node dist/adapters/cli.js get icon-park:search --format svg

# Validate a project policy
node dist/adapters/cli.js policy validate icon-policy.example.json
```

The CLI never writes SVG files. Pipe or redirect stdout when a human deliberately chooses a destination.

## MCP

Build first, then configure an MCP client to launch:

```text
node /absolute/path/to/icon-svg-select/dist/adapters/mcp.js \
  --policy /absolute/path/to/project/icon-policy.json
```

The policy path is a server-operator startup argument. MCP tools do not accept paths, URLs, raw SVG, or source code.

The dominant Agent request should take one call:

```text
resolve_icon({ intent: "settings", context: "toolbar" })
```

If policy has pinned that semantic intent, the result includes the chosen id and rendered SVG. If several candidates have the same basis, the result is `ambiguous` and lists candidates without producing geometry.

When the human explicitly asks to compare visually or rejects an earlier choice, use:

```text
choose_icon({ intent: "notification", requestId: "optional-correlation" })
```

An MCP Apps-capable host opens the same picker. Grid clicks only change the local preview. `Attach to conversation` updates future model context; `Select & continue` sends the typed decision as an explicit user message. Hosts without MCP Apps continue to use the four direct tools and the standalone UI/copy fallback.

The repository root is also a Codex plugin bundle: [plugin.json](./.codex-plugin/plugin.json), [.mcp.json](./.mcp.json), and the thin [product Skill](./skills/icon-svg-select/SKILL.md) all route to the same built server.

## Policy

Start from [icon-policy.example.json](./icon-policy.example.json). `selections` is the project-owned semantic decision layer:

```json
{
  "selections": {
    "settings": "icon-park:setting-two",
    "设置": "icon-park:setting-two"
  }
}
```

The structural schema is [icon-policy.schema.json](./icon-policy.schema.json) and is generated from the runtime Zod model. Unknown fields are rejected. `policy validate` additionally checks semantic-key normalization collisions and whether selected icon ids exist in the pinned provider.

`size` and `strokeWidth` are final rendered CSS-pixel values. The provider converts that visible stroke width into the source viewBox units before asking IconPark to render, so a `2` remains a 2px stroke at either 20px or 24px output size.

## Architecture

```text
Standalone UI ─┐
CLI ───────────┼── adapters ── IconKernel ── validated search index ── @icon-park/svg
MCP tools ─────┤                    │
MCP App UI ────┘                    ├── policy + semantic selections
                                    ├── ambiguity and stable errors
                                    └── deterministic, sanitized SVG result
```

There is deliberately no cloud account, shared `lastSelection`, policy editor, fallback collection, or Figma-only product fork. A future Figma adapter should consume the same SVG and selection contracts rather than recreate their rules.

## Licenses

This project is MIT licensed. IconPark code and assets remain under Apache-2.0; rendered results identify that license.
