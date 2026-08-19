# Armorial repository contract

This repository owns a design-system-aware icon selection kernel. Current source and executable contracts outrank generated examples or prior reports.

## Product boundary

- The current asset provider is the pinned `@icon-park/svg` package. Reuse its geometry; do not invent, redraw, or silently mutate SVG paths.
- The kernel owns metadata validation, deterministic search, project policy resolution, per-call render overrides layered over the effective policy, capability reporting, ambiguity, rendering, and stable errors.
- CLI, local web UI, MCP/MCP App, and Figma are adapters over the same `IconKernel`; do not duplicate search, policy, rendering, or selection-decision rules in an adapter.
- A policy supplies default/context IconPark parameters and may pin semantic selections. A per-call render override that changes those values must be reported as `overridden`, not silently called policy-compliant. The product must not claim that arbitrary filled SVG libraries can be normalized by changing stroke attributes.
- MCP tool inputs never accept paths, URLs, raw SVG, source code, or unrestricted objects. The server operator may load one policy file at startup.
- Generated SVG must be deterministic for the same icon and effective policy, have bounded size, and contain no scripts, event handlers, or external references.
- `icon-policy.schema.json` is generated from `IconPolicySchema`; `npm run schema:check` must detect drift.

## Acceptance lanes

- Development regression: `npm run check`.
- Runtime Agent transport: start `armorial-mcp`, verify five model-visible tools plus one app-only helper, execute resolve/search/get/batch/choose through MCP with and without the `render` override, and read the MCP App resource.
- Runtime human surface: execute CLI search, ambiguity, policy-pinned resolve, SVG output, and invalid-policy recovery; launch the web UI and exercise search, selection, appearance override and reset, Copy SVG, download, drag data, Copy for Agent, and narrow layout; import the Figma development plugin and exercise click/drop insertion, real Component creation, outline, layer structure/naming, settings persistence, and readback on a disposable page.
- Business and experience acceptance remains an owner judgment; green checks do not make that verdict.
