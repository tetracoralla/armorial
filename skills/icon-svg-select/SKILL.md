---
name: icon-svg-select
description: Choose and use consistent UI icons while building or revising websites, apps, toolbars, navigation, and controls. Armorial searches English/Chinese IconPark meanings, applies project style, and delivers existing SVG assets or a visual picker.
---

# Armorial

Use Armorial when a UI task needs existing icons and IconPark fits the project.
The user need not name the tool. Preserve an established project icon system or
an explicit visual requirement; do not replace it just to use Armorial.

Choose the metaphor from the action and surrounding interface. For example,
renewal could use refresh, and a membership benefit could use crown or star.
You can compare appearance and choose among candidates using your judgment.
An ambiguous result means the deterministic matcher has not chosen; it does
not prevent you from choosing an id. Ask the human when their preference would
materially change the result, or open the picker when visual comparison helps.

## Select and deliver

| Need | Available route |
| --- | --- |
| One or several meanings, before rendering | `select_icons({intents:["search","settings"]})` returns ordered ids, policy, and unresolved candidates without SVG. |
| One meaning and its SVG | `resolve_icon({intent:"search"})` includes the rendered asset. |
| Explore a meaning or visual alternative | `search_icons({query:"notification"})`, then choose an id. |
| Render chosen ids | `get_icon({id:"icon-park:search"})` or `get_icons({ids:[...]})` (up to 8 SVGs). |
| Human comparison | `choose_icon({intent:"notification"})` opens the workbench. Only an explicit selection message supplies the human's choice. |

For partial selection, keep the successful mappings and work on the unresolved
entries. Refine a meaning, compare candidates, or choose an exact id as needed.
Batch related work when useful; call counts are an optimization, not a limit on
investigation. Render through Armorial to preserve provider geometry and style;
consumer markup, accessibility, layout, and visual judgment remain your work.

Pass a known configured `context` key, or omit it. Explicit appearance changes
use typed `render` settings, not edits to returned SVG paths. The response reports
the effective policy and any override. Inspect generated assets when debugging
requires it; avoid bringing large geometry dumps into context unnecessarily.

## Without MCP, or when writing assets

An installed Host may supply `scripts/armorial` beside this Skill. Otherwise use
an available `armorial` command or the CLI from a deliberately built source
installation. Do not guess installation paths or assume the Host is required.
Use that executable in the task's working directory:

```sh
armorial select search settings close
armorial resolve search --format svg
armorial batch icon-park:search icon-park:setting --output icons.svg
```

`select` accepts up to 20 meanings and returns compact JSON. `batch
--resolve-intents` can select and write a sprite together. For files, HTML
integration, appearance flags, and interrupted-write recovery, read
[artifact-output.md](references/artifact-output.md). If an installation lacks
`select_icons` or `select`, the existing resolve/search routes remain usable.
If no Armorial runtime is available, state that limitation and use a suitable
existing project route; never describe another library's output as Armorial's.

For a human `[icon-selection:v3]`, `v2`, or `v1` message, use
[selection-messages.md](references/selection-messages.md) to reproduce the asset.
Finish with the icon integrated in the requested work; expose protocol details
only when needed to resolve a mismatch or support the user's next action.
