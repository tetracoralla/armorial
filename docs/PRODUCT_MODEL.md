# Product model

Armorial helps designers, developers, and Agents choose consistent interface
icons and deliver usable assets. It combines the pinned IconPark collection,
English/Chinese discovery, executable project defaults, a visual workbench,
and programmatic access. It works locally without an account or cloud service.

## Task fit

Use it when an interface needs existing icons and IconPark fits its visual
language. Keep an established icon library when it already serves the project.
Selection quality includes the metaphor, recognizability at the displayed size,
style consistency, accessibility, and successful integration in the destination.
A technically valid SVG alone does not establish those outcomes.

The deterministic kernel resolves known names, aliases and project semantic
selections. It reports candidates when its rules cannot distinguish them.
The human or calling Agent can interpret business meaning, compare appearance,
and choose an exact id. That judgment is part of using the product; it is not
forbidden by deterministic execution. Armorial preserves provider geometry
rather than generating a new illustration or claiming another corpus is IconPark.

## Human work

Search or browse, compare icons, adjust appearance, then copy, download, drag,
or insert in Figma. The workbench supports English and Simplified Chinese.
Standalone Copy link stores the exact id, effective appearance and asset hash
in the URL fragment. Opening it selects and renders that icon; a mismatch is
shown for review. It does not share project paths, policy names or account data.
CSS variables and `currentColor` still depend on the consuming environment.

In Figma, insertion can create a real Component or editable frame, place it at
the viewport center or drop location, and preserve, flatten or union outlined
layers. The adapter owns Figma operations; search and rendering remain shared.
Figma appearance and output settings persist in client storage.

Search and rendering are asynchronous. Exports use the settled query and style;
stale results cannot be delivered as a new intent. Failed requests permit
recovery without silently exporting an old choice. A failed Agent delivery
retains a valid selection and Copy for Agent recovery.

## Agent work

- `select_icons` / CLI `select` choose up to 20 meanings without generating SVG.
  Ordered results include selection basis, policy and all unresolved candidates.
- `resolve_icon` returns a choice and rendered SVG for one meaning.
- `search_icons` supports exploration; `get_icon` and `get_icons` render chosen
  ids. MCP geometry batches admit 8 ids; the direct CLI/library admits 20.
- CLI sprites deliver several icons to files without replaying geometry through
  model context. See [CLI.md](CLI.md) for usage and file effects.
- `choose_icon` opens the shared workbench. Clicks compare locally; Attach adds
  context, and Select & continue sends one explicit user selection. Other work
  can continue while a human decision is pending.

`[icon-selection:v3]` carries exact id, effective render style, asset hash and a
current-task scope. It grants no unrelated authority. Versions 1 and 2 retain
their compatibility interpretation in the shipped Skill reference. There is no
process-global last selection or automatic delivery from a grid click.

## Architecture and compatibility

`IconKernel` owns validation, metadata selection, ranking, policy, ambiguity,
rendering and stable errors. CLI, MCP, web, and Figma adapt that domain behavior.
Appearance layers as defaults, then configured context, then explicit override.
Every render reports `compliant` or `overridden`. Assets preserve the upstream
viewBox and geometry, deterministic internal ids, license and bounded bytes.
The policy schema is generated from its runtime model.

The product/package/plugin is Armorial. Existing `icon_svg_select` MCP server
key, `ICON_SVG_SELECT_POLICY`, legacy executable aliases, and picker resource
URI remain compatible. Current capabilities and bounds live in
`src/core/contracts.ts`; test navigation is in [REVIEW_CONTRACT.md](REVIEW_CONTRACT.md).

New interfaces and methods should follow actual task needs. The current API,
carrier choices and verification examples describe this implementation; they
are not a ceiling on future design or the caller's reasoning.
