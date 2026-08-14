# Product model

## Users and tasks

The human user is a designer or product engineer selecting an existing icon and applying one project's visual rules. Their primary flow is search or browse, compare, select, preview, and then copy, download, or drag the SVG into another tool. This flow is complete without an Agent, account, cloud service, or Figma-specific integration.

The Agent task is narrower: stop spending model reasoning on SVG geometry. Given an explicit semantic intent and optional surface context, retrieve an existing icon, apply the project's executable icon policy, and return a bounded structured result. If multiple icons have the same semantic basis and policy does not choose one, report the ambiguity instead of drawing or guessing.

The optional connected flow exists for one reason: when an Agent's prior icon choice is unsatisfactory or genuinely ambiguous, the human can make the visual choice and return that exact decision to the current task. The UI does not become an Agent console and does not expose MCP names, schemas, prompts, or protocol state.

## Related flows

- Standalone human: search or browse -> select -> inspect the policy-rendered preview -> copy SVG, download SVG, or drag SVG outward.
- Copy-to-chat fallback: select -> copy a bounded `icon_selection` message -> paste it into any Agent conversation.
- Agent-hosted handoff: an Agent opens the picker with an intent -> human selects -> explicitly attach the decision or send `Select & continue` -> the Agent verifies the exact icon and continues the already-authorized task.
- Agent dominant path: `resolve_icon(intent, context?)` once.
- Agent inspection path: `search_icons(query)` -> `get_icon(id)`.
- Agent human-decision path: `choose_icon(intent, context?, requestId?)` once, then wait for the UI's explicit decision message.
- Agent batch path: `get_icons(ids)` once, preserving input order and per-item failures.
- Project setup: validate one policy, then load it into CLI or the MCP process.

## Operation objects and states

### Selection session

- Value: a temporary local comparison of policy-compliant IconPark candidates.
- Attributes: query, optional category, optional context, candidates, selected icon, and optional originating request id.
- Actions: search, filter category, select, copy SVG, download SVG, drag SVG, copy for Agent, attach to the current conversation, and select and continue.
- Unsupported actions: editing project policy, redrawing paths, publishing a global selection, choosing a destination task, or executing unrelated Agent work.
- Lifecycle: `empty -> loading -> ready | error`; selection is `none | selected`; Agent handoff is `idle -> sending -> sent | failed`.
- Recovery: failed search retains the prior selected icon; failed Agent delivery retains the selection and keeps `Copy for Agent` available.

### Icon selection decision

The UI returns a typed decision, not raw SVG, when communicating with an Agent:

```json
{
  "kind": "icon_selection",
  "version": 1,
  "decisionId": "sha256-of-the-stable-decision",
  "requestId": "optional-originating-request",
  "iconId": "icon-park:notification",
  "intent": "notification",
  "context": null,
  "assetSha256": "sha256-of-the-policy-rendered-svg",
  "scope": "current_task"
}
```

`decisionId` is deterministic so retrying the same explicit decision is idempotent. There is no process-global `lastSelection`, implicit polling, or automatic delivery on grid click. `scope` only resumes the current task's existing authority; it grants no new operation.

### Visible design objects

- Category navigation filters the candidate collection and carries a selected state.
- Search changes the candidate collection and has loading, error, and recovery feedback.
- Icon cells select one exact icon; selection changes the preview but sends nothing.
- Preview and policy summary represent the selected icon and its effective render contract.
- Copy, download, and drag deliver the SVG for direct human use.
- Copy for Agent delivers the typed decision as text and is always available after selection.
- Attach and Select & continue appear only when the host bridge is available. Both require an explicit click and report sending, success, or failure.

## Reuse inventory

- Geometry and parameterized rendering: pinned `@icon-park/svg@1.4.2`.
- Search corpus: the package's `icons.json` names, Chinese titles, English and Chinese categories, and tags.
- Agent transport: the official Model Context Protocol TypeScript SDK.
- Runtime and transport validation: one set of Zod contracts.

No existing application, component library, CLI, MCP server, or local policy existed in this workspace when the kernel was started.

## Shared deterministic core

`IconKernel` is the only business entry point. It calls a validated IconPark provider, a deterministic lexical ranker, policy resolution, ambiguity rules, and a sanitizing deterministic SVG renderer. CLI and MCP only translate transport inputs and presentations.

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
- Standalone mode owns direct human export. An Agent host may add decision-delivery actions according to its declared capabilities; the picker exposes no account-connection or authorization state.
- HTML drag exposes SVG and text transfer types, but actual drop acceptance remains the destination application's behavior. Copy and download are the guaranteed carriers.
- The UI shows the effective project-policy values. It does not present editable controls that could produce an SVG the Agent cannot reproduce through `get_icon`.
- No cloud account, collaboration backend, shared selection state, Figma-only component conversion, fallback collection, vector search, or path editing is part of this delivery.
- A Figma-specific adapter may later consume the same SVG or decision contract without becoming the product's primary surface.
