# Armorial

Armorial is a local-first, design-system-aware icon workbench and deterministic service for humans and AI Agents. It retrieves existing IconPark geometry, applies one executable project policy, and returns the same approved asset through a web UI, library, CLI, or MCP server.

[Open the Armorial workbench](https://tetracoralla.github.io/armorial/) — the hosted version runs the same pinned icon kernel entirely in the browser and sends no icon query to a server.

![Armorial workbench selecting a policy-rendered notification icon](./docs/assets/armorial-workbench.png)

It does not ask a model to draw SVG. It also does not pretend arbitrary filled icon libraries can be normalized by changing `stroke-width`.

## Agent discovery and selection

Use Armorial when the task is to find and render an existing IconPark icon,
apply a project's explicit icon policy, compare deterministic candidates, or
hand a genuine visual choice to a person. Do not use it to draw logos or
illustrations, edit arbitrary SVG paths, search other icon collections, or make
an aesthetic decision automatically.

The public [task and integration guide](https://tetracoralla.github.io/armorial/agent-selection.html)
gives an Agent the supported intents, rejection cases, privacy and effect
boundaries, deployment-pinned source installation route, a repeatable probe, and
the point at which Agent Host becomes useful. The path-scoped
[`llms.txt`](https://tetracoralla.github.io/armorial/llms.txt) is a small map to
that guide and the authoritative repository documents; it is not a tool
manifest or a quality claim.

The project deployment intentionally contains no `/armorial/robots.txt`.
Crawler policy is an origin-level responsibility; when the organization wants
to advertise this Sitemap from robots, `https://tetracoralla.github.io/robots.txt`
must be owned and published by the root site. In the absence of a root policy,
the workbench and task guide carry explicit per-page indexing metadata.

Armorial does not currently publish an npm package or official MCP Registry
entry. The repository now carries version-aligned `server.json` and npm
`mcpName` metadata, and the package-default `armorial mcp` route has passed the
official publisher's online validation plus an isolated packaged-runtime probe.
Publication remains a separate owner action after the npm package is released;
the checked-in metadata does not claim that external installation already
works.

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

The Figma development plugin remains a source/release artifact and is not
carried inside the npm package. Figma does not install this adapter through
npm, so including it would increase every CLI/MCP installation without making
the Figma flow more installable.

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

# The same typed appearance override as MCP/Web/Figma
node dist/adapters/cli.js get icon-park:search --format json \
  --theme two-tone --size 32 --stroke-width 2 \
  --primary '#0f172a' --secondary '#2f88ff'

# Compact semantic discovery followed by one model-context-free sprite file
node dist/adapters/cli.js resolve shopping-bag --format text
node dist/adapters/cli.js batch icon-park:user icon-park:shopping-bag \
  --format json --symbol-prefix ui- --output generated/armorial-sprite.svg

# Validate a project policy
node dist/adapters/cli.js policy validate icon-policy.example.json

# Start the same MCP server through the package-default executable
node dist/adapters/cli.js mcp --policy icon-policy.example.json
```

The CLI writes an SVG file only when `batch` receives an explicit relative
`.svg` `--output` inside the current working directory. That SVG path is
create-only by default. Replacing an existing SVG requires
`--allow-optimistic-overwrite`; a successful replacement reports
`protectionLevel: "optimistic_preflight_only"` and a `concurrencyWarning`
because a non-cooperating writer can still save in the final check-to-rename
window. Passing that replacement-only flag for a new SVG is invalid and creates
nothing. A successful new SVG reports `protectionLevel:
"non_overwriting_create"`; its `0644` default is narrowed by the caller's
umask, and an explicit replacement preserves the admitted target mode. For HTML, the default
safe route reads `--inline-from <source.html>` and publishes a distinct,
create-only `--output <candidate.html>` without modifying the source or an
existing output. `--format json` is accepted as the compact stdout summary
request, while the older `--format sprite` spelling remains supported. The
route returns only compact paths, byte counts, hashes, symbol counts, and its
declared protection level. `resolve --format text` keeps
successful semantic discovery compact. The typed appearance flags map to the
same core render override used by MCP, Web, and Figma. A sprite rejects
`--size` because a `<symbol>` has no final rendered size; set width/height on
each consuming `<svg>` instead. Sprite batching accepts
exact ids only, preserves input order, emits no partial sprite, and gives each symbol the stable id
`<symbol-prefix><canonical-slug>` so durable HTML automation does not replay SVG
paths through model context. The CLI resolves its policy the same way as the MCP
server: `--policy`, then `ICON_SVG_SELECT_POLICY`, then `./icon-policy.json` in
the working directory, then the built-in default.

Inline HTML input is a bounded artifact carrier, not an unrestricted document
rewriter. The fail-closed default is:

```text
armorial batch icon-park:user --format json \
  --inline-from page.html --output page.armorial.html
```

The candidate path must be new, inside the current working directory, and
physically distinct from the source; exact paths and hard-link aliases are
rejected. A failure before publication authorization leaves both the source
and any pre-existing output byte-identical. Successful JSON reports `sourceSha256`,
`candidateSha256`, and `protectionLevel: "non_overwriting_candidate"`. Those
hashes identify bytes; they are not atomic commit credentials.

SVG, candidate, and explicit optimistic HTML publication run in a bundled,
bounded helper whose working directory is pinned to the admitted parent
directory inode. Replacing that parent path before helper startup closes before
any write; replacing it after startup cannot redirect temporary or final bytes
through the replacement path. The helper uses only relative basenames inside
that pinned directory. A portable destination basename may contain no
backslash and at most 255 UTF-8 bytes; invalid names close as `INVALID_INPUT`
before publication. Its short,
random, exclusively created temporary name is independent of the destination,
so a legal 255-byte basename does not become too long during staging. The
helper validates the complete stdin byte count and hash, fsyncs and reads back
its private temporary file, and sends bounded readiness over a private IPC
channel. The CLI grants publication with a one-use token only while the parent
is still alive. Parent death or the five-second helper deadline before that
grant authorizes no final output. The helper normally removes private staging;
if the destination parent loses unlink permission after staging, a surviving
CLI preserves the original cancellation/deadline cause and reports bounded
`publication.effect: "none"`, cleanup status, and the private residue basename,
mode, byte count, and completeness. Pre-commit staging remains private `0600`;
restore access and inspect/remove that sibling before retrying.

The grant is the publication commit boundary. Once the helper receives it, a
caller or host interruption can occur after the final path changes but before
the compact success summary arrives. That narrow state cannot be made
transactional across a filesystem and process response. After any interrupted
or `PUBLICATION_OUTCOME_UNCERTAIN` carrier call, inspect the intended destination before
retrying; do not infer absence from a missing success response. An abrupt
helper crash during create-only hard-link publication can also leave its
private `.armorial-publish-*.tmp` sibling link, which must not be treated as a
second candidate or removed without verifying the intended destination first.

Caller-owned HTML must be valid UTF-8, no larger than 8 MiB, and
contain exactly one explicit HTML body. The Armorial-managed marker block has a
separate 512 KiB byte ceiling, plus four canonical framing bytes, so a valid
published carrier may be at most 8,912,900 bytes and remains admissible for an
exact retry or replacement. Armorial enforces a 5-second parse deadline, 50,000-node and
50,000-attribute structural ceilings, a 256-open-element ceiling, a 2 MiB
retained-attribute budget, and a 64 Ki-code-unit lexical-token ceiling before
publication.

Replacing an existing SVG and the pre-0.7 in-place HTML route are retained only
as explicit optimistic modes:

```text
armorial batch icon-park:user --format json \
  --inline-into page.html --allow-optimistic-overwrite
```

Both routes revalidate the target identity and metadata immediately before
rename; HTML additionally revalidates the complete admitted bytes. Portable
filesystem APIs cannot atomically compare those facts and replace the path. A
non-cooperating writer can still save in that final window and be overwritten.
Every successful optimistic result therefore reports `protectionLevel:
"optimistic_preflight_only"` and a `concurrencyWarning`; neither route is the
default. These are breaking pre-1.0 changes in 0.7.0; see
[CHANGELOG.md](./CHANGELOG.md).

The build also measures fresh 1, 4, 7.5, and 8 MiB calls against a 6-second
boundary and a conservative 256 MiB aggregate-RSS boundary formed by adding
the parent and publisher process maxima. These limits protect the carrier
operation; they are not claims about browser rendering cost.

## MCP

Build first, then configure an MCP client to launch:

```text
node /absolute/path/to/armorial/dist/adapters/mcp.js \
  --policy /absolute/path/to/project/icon-policy.json
```

The equivalent package-default command is `armorial mcp --policy ...`. The
Registry-ready [`server.json`](./server.json) uses that explicit subcommand so
npm clients cannot mistake the human CLI for the MCP process when the package
contains several executables. After—not before—`armorial@0.7.0` is published to
npm, the declared Registry launch shape is `npx armorial@0.7.0 mcp`.

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

For local host testing, run `npm run plugin:check`. It assembles the ignored `plugins/armorial/` directory from the exact `npm pack` contents, installs production dependencies from `package-lock.json` without lifecycle scripts, gives the staged manifest a fresh local Codex cachebuster, and probes the isolated MCP entry with a project policy. [`.agents/plugins/marketplace.json`](./.agents/plugins/marketplace.json) points at that generated directory, so a fresh clone must run this command before adding the local marketplace. The staging swap rejects symlink ancestors and does not expose a half-written plugin. The result contains no Armorial first-party `src/` or `test/`, dev dependencies, package lock, Git data, or production test hooks. Its installed third-party packages remain the upstream production package payload and may include their own source or test-named files; this staging route is not the trimmed immutable release. After changing the plugin, re-run the command, reinstall, and start a new Codex session so the cached copy updates.

Armorial's current public distribution is the GitHub repository, the static GitHub Pages workbench, and source releases. The Pages deployment publishes `source-commit.txt`, the exact immutable Git commit used for its task guide and workbench; the public probe checks out that commit instead of mutable `main`. The npm-shaped tarball and checksummed macOS arm64 Codex-plugin archive are staging and verification artifacts. The immutable builder removes declaration/TypeScript and exact test/spec dependency payload only when no current Node production package target protects it; source/types/development/browser-only conditions are not treated as Host runtime. Its report names the protected conditions and retained public runtime paths instead of claiming dependency-wide zero source or tests. Their probes bind behavior to the exact bytes under test; the current release builder does not claim byte-for-byte reproducibility across independent dependency installations. This work prepares npm and MCP Registry metadata but does not publish either one.

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

This project is licensed under the Apache License 2.0; see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). IconPark code and assets remain under Apache-2.0; rendered results identify that license. Exact bundled license texts are recorded in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md); the Figma distribution ships the exact subset it embeds in [figma-plugin/THIRD_PARTY_NOTICES.txt](./figma-plugin/THIRD_PARTY_NOTICES.txt).
