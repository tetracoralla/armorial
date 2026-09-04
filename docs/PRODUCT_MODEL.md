# Product model

## Product identity and stable identifiers

The public product, repository, npm package, and Codex plugin are named
**Armorial**. The `openAdam` name is the public developer attribution; the
GitHub repository is maintained under `tetracoralla/armorial`.

Brand identity is not the protocol contract. The descriptive Skill name,
`resolve_icon` and sibling MCP tool names, the `icon_svg_select` server key,
`ICON_SVG_SELECT_POLICY`, `ui://icon-svg-select/picker.html`, the
`[icon-selection:vN]` carrier family and deterministic SVG id prefixes remain stable; v3 is current and the Skill retains guarded v1/v2 reproduction paths.
The package exposes `armorial`, `armorial-mcp`, and `armorial-ui` as the primary
commands while retaining the earlier descriptive commands as compatibility
aliases. `armorial mcp` deliberately reaches the same stdio server through the
package-default executable; MCP Registry npm metadata uses that subcommand so
clients do not need to select a secondary bin.

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
- Agent inactive-provider path: load the product Skill, then invoke its
  version-locked direct launcher without adding the MCP schemas to every turn;
  typed CLI flags carry the same explicit appearance override when requested.
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
  "version": 3,
  "decisionId": "sha256-of-the-stable-decision",
  "requestId": "optional-originating-request",
  "iconId": "icon-park:remind",
  "intent": "notification",
  "context": null,
  "render": {
    "theme": "outline",
    "size": 32,
    "strokeWidth": 4,
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

The collection capability declaration is explicit: IconPark uses mixed stroke/fill geometry, supports theme transformation, and safely accepts stroke width, line cap, and line join parameters. Policy `strokeWidth` is IconPark's integer 1-4 weight on its source grid, matching the upstream parameter and scaling proportionally with icon size. The renderer preserves and returns each icon's upstream viewBox rather than assuming every asset is exactly 48 by 48. The kernel makes no claim about other collections.

## Agent route budget

- Ordinary supported request: one `resolve_icon` call.
- Exact inspection: one `get_icon` call when the canonical id is already known.
- Genuine semantic ambiguity: one `resolve_icon` response listing the decision candidates; a semantic selection in project policy removes repeat ambiguity.
- Invalid input: one stable error response, without retries or generic SVG generation.
- Batch needed in the current Agent turn: one call, at most 8 ids, with the
  complete MCP envelope bounded to 80 KiB. Structured automation and durable
  HTML batches use one CLI `batch --resolve-intents` call for up to 20 compact
  meanings, or one exact-id batch when selection is already settled. A
  selection-only request for two or more semantic meanings uses that same
  command without an output carrier; it returns one ordered, indexed intent/id
  mapping and does not render SVG. A durable intent batch resolves and renders
  inside one process, reports all resolved
  mappings plus bounded candidates for every unresolved meaning in one failed
  response, fails before mutation if any meaning is ambiguous or missing, deduplicates shared canonical ids,
  and returns only the compact intent/id mapping plus carrier integrity. A same-origin served
  artifact uses a new, create-only `--output <task-local-relative.svg>` and
  reports `protectionLevel: non_overwriting_create`; a
  single-file or direct
  `file://` HTML artifact defaults to `--inline-from <source.html> --output
  <new-candidate.html>`, so SVG payloads never enter model context and the
  source is never mutated. The candidate is create-only and must not resolve to
  the source path or a hard-link alias. Its compact result includes source and
  candidate hashes plus `protectionLevel: non_overwriting_candidate`; hashes
  identify bytes and are not atomic commit credentials. The caller may review
  or adopt that candidate using its own file workflow.

  Every SVG or HTML publisher delegates final I/O to the same bounded helper.
  The child process validates that its OS-resolved working directory has the
  admitted parent device/inode before any write, then uses relative basenames
  only. Portable destination basenames contain no backslash and are bounded to
  255 UTF-8 bytes; the helper uses a
  short random exclusive temporary name that is independent of the destination
  and cleans it only after actual creation. A parent path replacement before startup closes; a replacement after
  startup cannot redirect writes away from the admitted directory object.
  After staging and readback, the helper sends bounded readiness over IPC and
  waits for a one-use commit token from its still-live CLI parent. Parent death
  or the CLI's five-second publication deadline before that authorization
  creates no final output and normally cleans the private temporary file. If
  destination-parent permissions prevent unlink, a surviving CLI preserves
  the original cause and reports `publication.effect: none` plus bounded
  cleanup/residue state; the pre-commit residue remains `0600`. The token is
  the commit boundary: an interruption after authorization can leave a valid
  final output without a success summary, so an interrupted caller must inspect
  the destination before retrying. A surviving CLI reports that state as
  `PUBLICATION_OUTCOME_UNCERTAIN`. A create-only helper crash between final
  hard-link creation and cleanup may also leave the private sibling link.
  Candidate and default SVG publication remain create-only. A new SVG's `0644`
  default is narrowed by the caller's umask; replacement preserves the admitted
  target mode. A new SVG rejects the replacement-only flag before publication.
  Replacing an
  existing SVG or using optimistic HTML requires
  `--allow-optimistic-overwrite`; both targets must still match their admitted
  file identity before replacement, and every success discloses
  `protectionLevel: optimistic_preflight_only` plus the final-window warning.

  The legacy in-place `--inline-into <task-local-relative.html>` route also
  revalidates complete bytes before rename. A non-cooperating writer can still
  save in either optimistic route's final check-to-rename window and be
  overwritten. Neither route is the default Agent or human route.
  Sprite generation preserves exact
  provider geometry, input order, and stable canonical symbol ids; it closes
  rather than emitting a partial or duplicate sprite. Because an SVG `<symbol>`
  has no final rendered dimensions, sprite routes reject `--size`; the consuming
  `<svg>` owns width and height.
- Inline HTML admission is explicit and fail-closed: caller-owned valid UTF-8
  up to 8 MiB, one explicit HTML body, an Armorial-managed marker block up to
  512 KiB, and at most four canonical framing bytes. This makes the physical
  carrier ceiling 8,912,900 bytes and keeps every accepted first publication
  admissible for exact retry or replacement. Parsing must finish within 5
  seconds, with at most 50,000 structural
  nodes and 50,000 attributes, at most 256 simultaneously open elements, at
  most 2 MiB of retained attribute names/values, and no lexical token longer
  than 64 Ki UTF-16 code units. Its single HTML5 structural parse discards
  caller text payloads, retains source offsets, and publishes original byte
  slices around only the generated marker block. A fresh-process build probe
  measures 1, 4, 7.5, and 8 MiB calls against a 6-second / 256 MiB max-RSS
  regression boundary; that observation complements rather than replaces the
  runtime admission limits.
- Sprite documents retain the SVG namespace so same-origin local assets can be
  referenced as `<use href="relative.svg#symbol-id">`; the direct CLI owns
  mechanical, non-overwriting HTML candidate generation for single-file and
  `file://` consumers.
- Explicit visual decision: one `choose_icon` call, then one human decision message; ordinary resolution never opens the picker implicitly.

The weakest intended client is a general MCP Agent that can select a tool from its name, first description sentence, and JSON schema. English and Simplified Chinese icon wording are supported by package metadata and compact aliases.

## Surface and integration boundary

- The same built UI supports a standalone local browser and an MCP App host.
- The Figma build reuses the same React workbench and browser-safe kernel behind an offline manifest. Its main sandbox validates the strict UI message, SVG envelope, and asset hash before invoking Figma-native insertion or geometry APIs.
- The npm carrier includes the library, CLI, local web UI, MCP server/App,
  product Skill, and Registry metadata. The Figma development plugin is built
  and distributed separately because Figma does not install it from npm.
- Standalone mode owns direct human export. An Agent host may add decision-delivery actions according to its declared capabilities; the picker exposes no account-connection or authorization state.
- HTML drag exposes SVG and text transfer types, but actual drop acceptance remains the destination application's behavior. Copy and download are the guaranteed carriers.
- The UI exposes appearance controls over the same typed render override that Agents pass as `render`; the decision message carries the final effective style, so any adjusted asset remains exactly reproducible through `get_icon`. The UI still does not edit the project policy file, present MCP names, schemas, or protocol state.
- No cloud account, collaboration backend, shared selection state, automatic library publishing, fallback collection, vector search, or path editing is part of this delivery.
- Figma component conversion is an adapter-owned output option over the same asset contract, not a second product kernel.
