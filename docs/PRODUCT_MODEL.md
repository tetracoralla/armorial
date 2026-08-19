# Product model

## Product identity and stable identifiers

The public product, repository, npm package, and Codex plugin are named
**Armorial**. The `openAdam` name is the public developer attribution; the
GitHub repository is maintained under `tetracoralla/armorial`.

Brand identity is not the protocol contract. The descriptive Skill name,
`resolve_icon` and sibling MCP tool names, the `icon_svg_select` server key,
`ICON_SVG_SELECT_POLICY`, `ui://icon-svg-select/picker.html`, the
`[icon-selection:vN]` carrier family and deterministic SVG id prefixes remain stable; v2 is current and the Skill retains the v1 reproduction path.
The package exposes `armorial`, `armorial-mcp`, and `armorial-ui` as the primary
commands while retaining the earlier descriptive commands as compatibility
aliases.

## Users and tasks

The human user is a designer or product engineer selecting an existing icon and applying one project's visual rules. Their primary flow is search or browse, compare, select, preview, and then copy, download, drag, or insert the asset directly in Figma. This flow is complete without an Agent, account, or cloud service.

The Agent task is narrower: stop spending model reasoning on SVG geometry. Given an explicit semantic intent and optional surface context, retrieve an existing icon, apply the project's executable icon policy, and return a bounded structured result. If multiple icons have the same semantic basis and policy does not choose one, report the ambiguity instead of drawing or guessing.

The optional connected flow exists for one reason: when an Agent's prior icon choice is unsatisfactory or genuinely ambiguous, the human can make the visual choice and return that exact decision to the current task. The UI does not become an Agent console and does not expose MCP names, schemas, prompts, or protocol state.

## Related flows

- Standalone human: search or browse -> select -> adjust appearance overrides (theme, colors, size, stroke, cap, join) with live preview -> copy SVG, download SVG, or drag SVG outward.
- Figma human: search or browse -> select -> adjust the same appearance override -> choose component, outlining, layer structure, and naming -> click to insert at the viewport center or drag to an exact canvas/container location.
- Copy-to-chat fallback: select -> copy a bounded `icon_selection` message carrying the final render style -> paste it into any Agent conversation.
- Agent-hosted handoff: an Agent opens the picker with an intent and an optional starting render style -> human selects and may adjust appearance -> explicitly attach the decision or send `Select & continue` -> the Agent verifies the exact icon and continues the already-authorized task.
- Agent dominant path: `resolve_icon(intent, context?, render?)` once.
- Agent inspection path: `search_icons(query)` -> `get_icon(id, render?)`.
- Agent human-decision path: `choose_icon(intent, context?, requestId?, render?)` once, then wait for the UI's explicit decision message.
- Agent batch path: `get_icons(ids, render?)` once, preserving input order and per-item failures.
- Project setup: validate one policy, then load it into CLI or the MCP process.

## Operation objects and states

### Selection session

- Value: a temporary local comparison of project-resolved IconPark candidates, with explicit validated appearance overrides when requested.
- Attributes: query, optional category, optional context, candidates, selected icon, optional originating request id, and an appearance override layered over the effective policy.
- Actions: search, filter category, select, adjust appearance (theme, four colors, size, stroke width, linecap, linejoin; reset to policy), copy SVG, download SVG, drag SVG, copy for Agent, attach to the current conversation, and select and continue.
- Unsupported actions: editing the project policy file, redrawing paths, publishing a global selection, choosing a destination task, or executing unrelated Agent work.
- Lifecycle: `empty -> loading -> ready | error`; selection is `none | selected`; Agent handoff is `idle -> sending -> sent | failed`.
- Recovery: failed search retains the prior selected icon; failed Agent delivery retains the selection and keeps `Copy for Agent` available.

### Figma insertion

- Value: one selected, policy-rendered IconPark asset materialized as editable Figma content.
- Attributes: canonical icon id, rendered SVG hash, appearance override, create-component flag, outline-stroke flag, layer structure (`preserve`, `flatten`, or `union`), layer name, placement mode, and destination parent.
- Actions: insert at viewport center, enter a compact drag mode to expose the canvas, drag to place, return to settings, create a real Component master, outline supported strokes, preserve/flatten/union layers, rename, and reset appearance.
- Unsupported actions: rewriting SVG paths, publishing a Figma library, mutating an instance or component set as a drop target, editing project policy, or creating a second Figma-only search/render implementation.
- Lifecycle: `selected -> inserting -> inserted | failed`; settings are `loading -> restored -> editable -> persisted` in Figma client storage.
- Recovery: validation and hash checks happen before the Figma write; a failed transform removes the partially created node and leaves the selection/settings available for retry. Compact drag mode surfaces the destination receipt or operation error without requiring the hidden settings inspector.

### Icon selection decision

The UI returns a typed decision, not raw SVG, when communicating with an Agent:

```json
{
  "kind": "icon_selection",
  "version": 2,
  "decisionId": "sha256-of-the-stable-decision",
  "requestId": "optional-originating-request",
  "iconId": "icon-park:remind",
  "intent": "notification",
  "context": null,
  "render": {
    "theme": "outline",
    "size": 32,
    "strokeWidth": 2,
    "strokeLinecap": "round",
    "strokeLinejoin": "round",
    "colors": {
      "primary": "currentColor",
      "secondary": "#2f88ff",
      "innerStroke": "#ffffff",
      "innerFill": "#43ccf8"
    }
  },
  "assetSha256": "sha256-of-the-final-rendered-svg",
  "scope": "current_task"
}
```

`decisionId` is deterministic so retrying the same explicit decision is idempotent. `render` is the final effective style behind the selected asset, including any appearance adjustments, so `get_icon` with that render reproduces the exact SVG and hash without depending on the context layer. There is no process-global `lastSelection`, implicit polling, or automatic delivery on grid click. `scope` only resumes the current task's existing authority; it grants no new operation.

### Visible design objects

- Category navigation filters the candidate collection and carries a selected state.
- Search changes the candidate collection and has loading, error, and recovery feedback.
- Icon cells select one exact icon; selection changes the preview but sends nothing.
- Preview and the Appearance panel represent the selected icon and its effective render contract; the panel's controls are the same typed override the Agent sends as `render`, with live preview, reset, and the read-only context line.
- Copy, download, and drag deliver the SVG for direct human use.
- In Figma, click insertion produces a selected node at the viewport center and canvas drag produces the same validated output at the drop target. `Create component` uses Figma's native component conversion, so the result is a Component master rather than a named frame.
- Copy for Agent delivers the typed decision with the final render style as text and is always available after selection.
- Attach and Select & continue appear only when the host bridge is available. Both require an explicit click and report sending, success, or failure.

## Reuse inventory

- Geometry and parameterized rendering: pinned `@icon-park/svg@1.4.2`.
- Search corpus: the package's `icons.json` names, Chinese titles, English and Chinese categories, and tags.
- Agent transport: the official Model Context Protocol TypeScript SDK.
- Runtime and transport validation: one set of Zod contracts.

No existing application, component library, CLI, MCP server, or local policy existed in this workspace when the kernel was started.

## Shared deterministic core

`IconKernel` is the only business entry point. It calls a validated IconPark provider, a deterministic lexical ranker, policy resolution (defaults, then context, then the per-call render override), ambiguity rules, and a sanitizing deterministic SVG renderer. CLI, MCP, web, and Figma only translate transport or host operations.

The local web server and MCP App are also adapters over `IconKernel`. They may paginate and present the catalog, but they do not implement a second search ranker, policy resolver, renderer, or selection format.

The collection capability declaration is explicit: IconPark uses mixed stroke/fill geometry, supports theme transformation, and safely accepts stroke width, line cap, and line join parameters. Policy `strokeWidth` is the final visible CSS-pixel width at the configured size; the provider converts it to the actual source viewBox units before rendering. The renderer preserves and returns each icon's upstream viewBox rather than assuming every asset is exactly 48 by 48. The kernel makes no claim about other collections.

## Agent route budget

- Ordinary supported request: one `resolve_icon` call.
- Exact inspection: one `get_icon` call when the canonical id is already known.
- Genuine semantic ambiguity: one `resolve_icon` response listing the decision candidates; a semantic selection in project policy removes repeat ambiguity.
- Invalid input: one stable error response, without retries or generic SVG generation.
- Batch: one call, at most 20 ids.
- Explicit visual decision: one `choose_icon` call, then one human decision message; ordinary resolution never opens the picker implicitly.

The weakest intended client is a general MCP Agent that can select a tool from its name, first description sentence, and JSON schema. English and Simplified Chinese icon wording are supported by package metadata and compact aliases.

## Surface and integration boundary

- The same built UI supports a standalone local browser and an MCP App host.
- The Figma build reuses the same React workbench and browser-safe kernel behind an offline manifest. Its main sandbox validates the strict UI message, SVG envelope, and asset hash before invoking Figma-native insertion or geometry APIs.
- Standalone mode owns direct human export. An Agent host may add decision-delivery actions according to its declared capabilities; the picker exposes no account-connection or authorization state.
- HTML drag exposes SVG and text transfer types, but actual drop acceptance remains the destination application's behavior. Copy and download are the guaranteed carriers.
- The UI exposes appearance controls over the same typed render override that Agents pass as `render`; the decision message carries the final effective style, so any adjusted asset remains exactly reproducible through `get_icon`. The UI still does not edit the project policy file, present MCP names, schemas, or protocol state.
- No cloud account, collaboration backend, shared selection state, automatic library publishing, fallback collection, vector search, or path editing is part of this delivery.
- Figma component conversion is an adapter-owned output option over the same asset contract, not a second product kernel.
