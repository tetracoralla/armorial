---
name: icon-svg-select
description: Select and render existing project-aware IconPark SVG icons for product UI work. Use when an Agent needs an icon, should not draw SVG geometry, must follow project defaults or an explicit appearance request, needs alternatives, or the human asks to choose visually or rejects an earlier icon choice.
---

# Armorial

Use Armorial as the only icon geometry and policy authority. Never redraw,
approximate, or silently edit returned paths. Prefer the named MCP tools when
they are available. When they are absent and this installed Skill contains the
managed `scripts/armorial` launcher, use that launcher as the direct fallback;
it is version-locked to the same immutable product bytes. Do not substitute a
source checkout, an arbitrary package command, another icon corpus, or
model-authored SVG.

## Route the request

1. For an ordinary semantic request, call `resolve_icon` once with one compact semantic intent rather than forwarding a full requirement sentence. Its successful result already contains the rendered asset; do not follow it with `get_icon`. Include `context` only when the exact configured 1-40 character ASCII key is already known; never turn a natural-language surface description into a context key, and omit it otherwise. When the user states exact appearance values (size, stroke width, theme, cap, join, or colors), pass them through the `render` parameter instead of describing them in prose.
2. If the user asks for alternatives, call `search_icons` with a short catalog-facing term such as an icon name, title, tag, or familiar alias. Search is deterministic metadata matching, not an embedded Agent: extra prose does not improve semantic understanding and can broaden or distort results through token and containment matches. Search one semantic axis at a time, compare the returned `matchedOn` fields, and use a second compact query when direction, object, or action needs separate exploration. Present the compact candidates, and call `get_icon` only after an exact id is chosen.
3. If the user explicitly wants to choose visually, rejects the prior choice, or taste is the remaining ambiguity, call `choose_icon` once. An optional `render` pre-sets the style the human sees; the human may adjust it in the picker. Tell the user to choose in the picker, then stop and wait for its explicit `icon_selection` message.
4. For an already-known id, call `get_icon`. For up to eight independent exact ids needed in the current turn, call `get_icons` once. Use the direct CLI/library route for larger or durable automation so SVG payloads do not enter model context.

If an ordinary business label is not itself a catalog term, first reduce it to
one visible object or action that fits the product meaning, then resolve or
search that compact term. For example, a membership benefit may be expressed
by a badge, crown, star, or member identity depending on the surrounding
product—not by forwarding the whole marketing sentence. If `resolve_icon`
returns `ambiguous` or `not_found`, search one or two compact semantic axes and
select from returned ids. Use the picker only when human taste remains the
unresolved choice. A deterministic miss is a routing signal, not permission to
draw an icon.

## Direct fallback

Use this section only when the MCP tools named above are unavailable and the
managed launcher exists next to this Skill.

- Ordinary intent whose SVG is needed immediately: run `scripts/armorial resolve <compact-intent> --format json` once.
- Discovery before a single exact choice: run `scripts/armorial resolve <compact-intent> --format text`. It returns the selected canonical id without sending SVG geometry through Agent context.
- Alternatives: run `scripts/armorial search <compact-query> --limit 8 --format json`.
- Exact id: run `scripts/armorial get <icon-id> --format json` or add `--format svg` when only the verbatim asset is needed.
- A bounded set of exact ids: run `scripts/armorial batch <icon-id...> --format json`.
- For a multi-icon HTML retrofit, inventory every actual consumer first—including close, disclosure, breakpoint-only, empty-state, and other text-glyph icons—and preserve all conditional inclusion rules. Then use one atomic intent batch instead of launching one resolver process per icon: `scripts/armorial batch <compact-intent...> --resolve-intents --symbol-prefix <safe-prefix> --output <task-local-relative.svg>` for a same-origin served artifact, or the same command with `--inline-into <task-local-relative.html>` for a single-file/direct-`file://` artifact. The compact success summary returns each intent's canonical id; update consumers to `<relative.svg>#<prefix><canonical-slug>` or local `#<prefix><canonical-slug>` from that mapping. A failed intent batch reports every resolved mapping plus every unresolved intent and bounded candidate ids in one response, and writes nothing. Choose or refine only those unresolved entries and rerun one corrected batch; do not individually resolve the entries already reported as resolved. When every canonical id is already known, omit `--resolve-intents` and pass those ids directly. The carrier implies sprite format, though explicit `--format sprite` is also accepted. Both carriers write atomically inside the current working directory and return only compact path/byte/hash/symbol-count and optional intent/id mapping metadata. Do not print/read/cat/head/sed/diff the generated geometry or otherwise place it in model context. A failed later non-sprite patch does not invalidate an unchanged completed sprite: reuse it rather than repeating the batch. A partial batch closes without publishing output; exact-id batches also close on duplicates, while intent batches safely share one symbol when two meanings resolve to the same canonical id. A later inline batch replaces the complete managed sprite; it does not append. If inventory missed an icon, rerun one full union batch. Armorial rejects an accidental subset before mutation; only after confirming removed symbols are unused may an intentional shrink pass `--allow-symbol-removal`.
- Derive every retrofit intent from the consumer's current accessible label, visible business action, and surrounding task—not from the old symbol id or its geometry. A legacy id such as `bag` or `pin` is only implementation history: `Cart` should resolve from cart/shopping-cart meaning, while a shipping-address affordance should resolve from location/map-marker meaning rather than a stationery pushpin. Preserve an old id only when its meaning is independently still correct.
- Pass `--context` or `--policy` only under the same rules as the MCP route.

Interpret the CLI `status`, errors, alternatives, policy metadata, and SVG the
same way as the matching MCP result. Exit status `2` is a closed input,
ambiguity, not-found, or policy failure; inspect its JSON rather than retrying
with prose. Never edit the returned SVG geometry. Add accessibility labels,
layout classes, and interaction semantics at the consuming UI element.

When retrofitting an existing artifact, inventory the current icon meanings and
actual consumers before changing it. Base the batch on references that are used,
not every definition present in an old sprite, and omit unused generated symbols.
Replace only geometry and the references required
to address that geometry. Preserve surrounding layout, colors, hover/pressed/
focus behavior, animation, labels, control semantics, and unrelated icons unless
the user requested a broader design change. Do not delete a visual state or
replace an icon with a text glyph merely to simplify integration. Verify every
consumer still resolves to one generated symbol and that non-icon behavior is
unchanged. Treat structural exceptions as part of the consumer contract: before
replacing a pseudo-element, glyph, or repeated icon, identify selectors and
conditions that suppress or vary it (for example first/last child, responsive,
state, or disabled cases), then preserve those exact inclusion rules in the new
markup or styles. Do not mechanically insert one replacement into every repeated
container when the original icon was conditional. Verify the final consumer/id
relationship with counts, hashes, or exact-id predicates that do not print the
generated SVG. In a real browser, return only the count and ids of missing or
zero-geometry visible consumers unless a wider page diagnosis is independently
necessary; do not load a full accessibility or DOM dump solely to prove icon
rendering.

A document favicon, brand mark, logo, illustration, or product image is not a
routine UI control icon. Preserve it unless the user explicitly put that asset
in scope or the current project policy identifies its replacement.

Do not open the picker for every routine request. It is a human decision return path, not a mandatory approval ceremony.

`resolve_icon` uses the same deterministic index plus configured policy
selections and aliases. It can recognize ordinary phrases that contain known
terms, but it does not infer arbitrary intent. Prefer a compact primary meaning;
keep usage context, exclusions, and visual evaluation in your own comparison of
the candidates rather than packing every criterion into the query.

## Continue from a human selection

When the conversation receives an `[icon-selection:v3]`, `v2`, or `v1`
message, read `references/selection-messages.md` before acting. Those versions
have different reproduction and hash-check rules. A selection authorizes only
the icon choice for the current task.

## Keep the human surface simple

Present icon name, useful meaning, and the resulting asset. Keep raw schemas, protocol metadata, hashes, and capability detail secondary unless a mismatch changes the decision.

If neither the MCP tools nor the managed launcher are available, say so plainly.
Do not substitute model-authored SVG as a fallback.
