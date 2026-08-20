# Armorial

Armorial is a local-first, design-system-aware icon workbench and deterministic service for humans and AI Agents. It retrieves existing IconPark geometry, applies one executable project policy, and returns the same approved asset through a web UI, library, CLI, or MCP server.

[Open the Armorial workbench](https://tetracoralla.github.io/armorial/) — the hosted version runs the same pinned icon kernel entirely in the browser and sends no icon query to a server.

![Armorial workbench selecting a policy-rendered notification icon](./docs/assets/armorial-workbench.png)

It does not ask a model to draw SVG. It also does not pretend arbitrary filled icon libraries can be normalized by changing `stroke-width`.

## What is working

- Validated local index over all 2,658 icons in `@icon-park/svg@1.4.2`.
- English and Simplified Chinese search across names, titles, categories, tags, plurals, and compact UI aliases.
- Project policy for theme, size, stroke width, cap, join, colors, per-surface overrides, and semantic icon selections.
- Per-call render overrides on the same typed settings, layered as defaults <- context <- explicit override, available identically to humans and Agents.
- Explicit ambiguity when equal semantic candidates are not pinned by policy.
- Deterministic SVG, including stable internal clip-path ids, exact per-icon viewBox, byte count, hash, license, capability, and an honest `compliant` or `overridden` policy status.
- Standalone visual workbench with browse/search, live appearance adjustment, preview, Copy SVG, download, and standards-based outward drag.
- Offline Figma development plugin over the same kernel: click insertion, canvas drop, real Component masters, optional stroke outlining, preserved/flattened/unioned layers, and explicit layer naming.
- Optional MCP App picker with explicit Attach and Select & continue actions; ordinary human use never requires an Agent.
- Five model-facing MCP tools: `resolve_icon`, `search_icons`, `get_icon`, `get_icons`, and the explicit visual-decision route `choose_icon`.
- One app-only `browse_icons` helper, excluded from model use by MCP App visibility metadata; enforcement is host-side.
- CLI equivalents for human inspection and shell composition.
- Strict input/output schemas, bounded queries and batches, safe color grammar, bounded SVG/response sizes, and per-item batch failures.
- A deterministic, bounded `icon_selection` decision format (v3) for copy-to-chat and connected continuation. It carries the final effective render style and contains no raw SVG or arbitrary instructions.

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

- adjust **Appearance** in the right inspector: theme, four colors, size, stroke weight, linecap, linejoin, and Reset. Adjustments re-render the grid and preview as a bounded per-session override; export waits for that redraw and never edits the project policy file.
- **Copy SVG** copies raw SVG for direct use in any editor that accepts it.
- **Download** saves an `.svg` file.
- drag an icon cell outward; the app supplies `image/svg+xml`, plain SVG text, and a download transfer. Whether a destination accepts a browser drag is controlled by that destination, so copy and download are the guaranteed carriers.
- **Copy for Agent** copies a compact `[icon-selection:v3]` decision, not the SVG. It carries the icon id, the final effective render style, and the rendered asset hash, so an Agent reproduces the exact adjusted asset through `get_icon`.

## Figma plugin

Build the self-contained development plugin:

```sh
npm run build:figma
```

In the Figma desktop app, choose **Plugins -> Development -> Import plugin from manifest...** and open `figma-plugin/manifest.json`. The plugin makes no network requests; its pinned IconPark catalog, deterministic search, rendering, and validation run locally.

- Search or browse the same 2,658 icons and adjust theme, four colors, size, stroke width, linecap, and linejoin.
- **Insert component** creates a genuine Figma Component master named `Icon/<icon-name>` at the current viewport center. Disable **Create component** to insert an ordinary editable icon frame instead.
- Use **Drag mode** to collapse the plugin to a canvas-friendly icon browser, then drag an icon cell onto the visible canvas to place the same output at the drop location; **Settings** restores the full workbench. A short receipt names the destination. A safe container target receives the new node; instances and component sets are never mutated.
- **Outline strokes** converts supported Figma strokes to editable filled vector outlines after import. **Layer structure** can preserve the imported hierarchy, flatten it to one vector, or make a Boolean union. **Layer name** controls the non-component root or merged layer name.
- Appearance and Figma-output settings are stored in Figma client storage and restored when the plugin is reopened. Reset clears the appearance override back to Armorial's effective default policy.

The checked-in manifest points at generated files under `figma-plugin/dist/`; those files are intentionally Git-ignored. Run the build before importing from a fresh clone. `npm run figma:probe` validates the manifest, offline declaration, bundle budgets, local catalog UI, and drag envelope without touching a Figma document.

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

The CLI never writes SVG files. Pipe or redirect stdout when a human deliberately chooses a destination. The CLI resolves its policy the same way as the MCP server: `--policy`, then `ICON_SVG_SELECT_POLICY`, then `./icon-policy.json` in the working directory, then the built-in default.

## MCP

Build first, then configure an MCP client to launch:

```text
node /absolute/path/to/armorial/dist/adapters/mcp.js \
  --policy /absolute/path/to/project/icon-policy.json
```

The policy is a server-operator startup decision, never a tool input. When no `--policy` argument is given, the server resolves one policy file at startup, in this order:

1. the `ICON_SVG_SELECT_POLICY` environment variable (absolute or working-directory-relative path), which plugin hosts and shell profiles can inject without changing launch arguments; use an absolute path with the Codex plugin because its declared working directory is the cached plugin root;
2. an `icon-policy.json` in the server's working directory, which is how a project pins its own design-system policy when the host launches the server from the project root;
3. the built-in default policy.

MCP tools do not accept paths, URLs, raw SVG, or source code.

The dominant Agent request should take one call:

```text
resolve_icon({ intent: "settings", context: "toolbar", render: { size: 32 } })
```

If policy has pinned that semantic intent, the result includes the chosen id and rendered SVG. If several candidates have the same basis, the result is `ambiguous` and lists candidates without producing geometry.

`render` is an optional per-call override with the same typed settings as the picker's Appearance controls (theme, size, strokeWidth, strokeLinecap, strokeLinejoin, and the four colors). It layers over the resolved context policy, and every result reports the final effective settings in `icon.policy`; `policyCompliance` becomes `overridden` when the request materially changes project values. The same parameter exists on `get_icon`, `get_icons`, `browse_icons`, and `choose_icon`, so a human's adjusted workbench style and an Agent's explicit request produce identical, reproducible assets.

When the human explicitly asks to compare visually or rejects an earlier choice, use:

```text
choose_icon({ intent: "notification", requestId: "optional-correlation" })
```

An MCP Apps-capable host opens the same picker. Grid clicks only change the local preview. `Attach to conversation` updates future model context; `Select & continue` sends the typed decision as an explicit user message. Hosts without MCP Apps continue to use the four direct tools and the standalone UI/copy fallback.

The repository root is also a Codex plugin bundle: [plugin.json](./.codex-plugin/plugin.json), [.mcp.json](./.mcp.json), and the thin descriptive [product Skill](./skills/icon-svg-select/SKILL.md) all route to the same built server. Published tarballs are self-contained: `npm pack` runs `prepack` and ships the built `dist/` (source maps excluded), so hosts that install npm packages without running lifecycle scripts start the entry points directly.

For local host testing, run `npm run plugin:check`. It assembles the ignored `plugins/armorial/` directory from the exact `npm pack` contents, installs production dependencies from `package-lock.json` without lifecycle scripts, gives the staged manifest a fresh local Codex cachebuster, and probes the isolated MCP entry with a project policy. [`.agents/plugins/marketplace.json`](./.agents/plugins/marketplace.json) points at that generated directory, so a fresh clone must run this command before adding the local marketplace. The staging swap rejects symlink ancestors and does not expose a half-written plugin. The result contains no sources, tests, dev dependencies, package lock, or Git data. After changing the plugin, re-run the command, reinstall, and start a new Codex session so the cached copy updates.

Armorial's current public distribution is the GitHub repository, the static GitHub Pages workbench, and tagged source releases. The npm-shaped archive is an internal reproducibility boundary for staging and verification; this release does not require an npm account or publish a registry package.

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

`size` is the final SVG width and height. `strokeWidth` uses IconPark's native integer weight scale from `1` (light) to `4` (bold), with the upstream default of `4`. The weight scales proportionally with the icon, so previews, copied SVGs, and Figma insertion retain the same geometry instead of changing apparent thickness when the asset is resized.

Policy version `2` makes that unit change explicit. To migrate a version `1` policy whose rendered-pixel widths were in the useful `0.5–2` range, multiply each default/context `strokeWidth` by `2`; larger legacy values have no direct equivalent and should be visually re-chosen within `1–4` rather than silently clamped.

## Architecture

```text
Standalone UI ─┐
Figma plugin ──┤
CLI ───────────┼── adapters ── IconKernel ── validated search index ── @icon-park/svg
MCP tools ─────┤                    │
MCP App UI ────┘                    ├── policy + semantic selections
                                    ├── ambiguity and stable errors
                                    └── deterministic, sanitized SVG result
```

There is deliberately no cloud account, shared `lastSelection`, policy editor, fallback collection, or Figma-only product fork. The Figma adapter consumes the same search, policy, rendering, and SVG safety contracts; it only owns canvas placement and Figma-native geometry operations.

## Licenses

This project is licensed under the Apache License 2.0; see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). IconPark code and assets remain under Apache-2.0; rendered results identify that license. The Figma bundle's third-party attributions are recorded in [figma-plugin/THIRD_PARTY_NOTICES.txt](./figma-plugin/THIRD_PARTY_NOTICES.txt).
