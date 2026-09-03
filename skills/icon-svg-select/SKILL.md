---
name: icon-svg-select
description: Select and render existing project-aware IconPark SVG icons for product UI work. Use when an Agent needs an icon, should not draw SVG geometry, must follow project defaults or an explicit appearance request, needs alternatives, or the human asks to choose visually or rejects an earlier icon choice.
---

# Armorial

Use Armorial as the only icon geometry and policy authority. Never redraw,
approximate, or silently edit returned paths. Use only the installed MCP tools
or the managed `scripts/armorial` launcher beside this Skill; never substitute a
source checkout, another icon corpus, or model-authored SVG.

## Route the request

1. For one ordinary meaning, call `resolve_icon` once with a compact visible
   object or action. Do not forward a full business sentence. Its successful
   result already includes the asset; do not follow it with `get_icon`.
2. For two or more meanings when only canonical ids are needed, first decide
   one compact visible meaning for every business label from its action and
   context. For example, renewal may deliberately use `refresh`; a membership
   benefit may deliberately use `crown`, `badge`, or `star`. That semantic
   choice remains Agent or human judgment. Then run exactly one installed CLI
   call:
   `scripts/armorial batch <compact-intent...> --resolve-intents --format json`.
   Use the ordered, indexed `items` mapping. Do not launch one resolver per
   intent. If any item is unresolved, keep every returned resolved mapping,
   search only the unresolved semantic axis, and issue at most one corrected
   batch.
3. For alternatives, call `search_icons` with one short catalog-facing term.
   Compare `matchedOn`; search a second axis only when object, action, or
   direction genuinely differs. Call `get_icon` only after an exact id is
   chosen.
4. For an already-known id, call `get_icon`. For up to eight independent known
   ids, call `get_icons` once. For a larger or durable set, use the installed
   CLI batch route so SVG payloads do not enter model context.
5. Open `choose_icon` only when the user asks to choose visually, rejects the
   prior choice, or taste is the remaining ambiguity. Stop after opening it and
   wait for its explicit selection message.
6. Before replacing several icons in an HTML artifact, read
   `references/html-retrofit.md`.

Include `context` only when its exact configured ASCII key is already known.
Pass explicit size, stroke width, theme, cap, join, or colors through `render`.
Do not invent a context key from prose.

## Installed CLI routes

- One id without SVG: `scripts/armorial resolve <compact-intent> --format text`.
- Alternatives: `scripts/armorial search <compact-query> --limit 8 --format json`.
- Exact asset: `scripts/armorial get <icon-id> --format json` or `--format svg`.
- Known id batch: `scripts/armorial batch <icon-id...> --format json`.

For an explicit appearance request on the managed CLI route, append the typed
flags `--theme`, `--size`, `--stroke-width`, `--stroke-linecap`,
`--stroke-linejoin`, `--primary`, `--secondary`, `--inner-stroke`, or
`--inner-fill`. They form the same bounded render override as the MCP `render`
object; do not edit returned geometry.
For a sprite carrier, omit `--size`: the consuming `<svg>` owns its rendered
width and height, so accepting a symbol size would be a no-op. Set the consumer
size while patching its markup or stylesheet.

Interpret CLI status, ambiguity, candidates, policy metadata, and assets exactly
like the matching MCP result. Exit status `2` is a closed input, ambiguity,
not-found, or policy failure; inspect its bounded JSON and do not retry with
longer prose. Add accessibility labels and interaction semantics at the
consumer, never by editing returned geometry.

## Continue from a human selection

For an `[icon-selection:v3]`, `v2`, or `v1` message, read
`references/selection-messages.md` before acting. The versions have different
reproduction and hash rules. A selection authorizes only the icon choice for
the current task.

Present the icon name, useful meaning, and resulting asset. Keep hashes and
protocol detail secondary unless a mismatch changes the decision. If neither
the MCP tools nor the managed launcher is available, say so and stop.
