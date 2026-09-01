# Multi-icon HTML retrofit

Use this route only when an existing HTML artifact needs several icon consumers
replaced. It is not required for an ids-only selection task.

## Inventory before mutation

- Inventory every actual consumer, including close, disclosure,
  breakpoint-only, state, disabled, empty-state, and text-glyph icons.
- Derive each compact intent from the consumer's accessible label, visible
  business action, and surrounding task—not from the old symbol id or shape.
- Preserve logos, favicons, illustrations, and product images unless they are
  explicitly in scope.
- Record selectors and conditions that suppress or vary repeated icons so the
  replacement retains the same inclusion set.

## Publish one bounded carrier

Use one atomic intent batch rather than one resolver process per icon:

- same-origin served artifact:
  `scripts/armorial batch <compact-intent...> --resolve-intents --symbol-prefix <safe-prefix> --output <task-local-relative.svg>`
- single-file or direct `file://` artifact:
  `scripts/armorial batch <compact-intent...> --resolve-intents --symbol-prefix <safe-prefix> --inline-into <task-local-relative.html>`

The command returns a compact mapping and integrity summary without printing
SVG. It writes nothing when any intent is ambiguous or missing, reports all
resolved mappings plus every unresolved intent, and bounds candidate ids. Keep
the resolved mappings, refine only unresolved meanings, then rerun one corrected
union batch. Intent batches may share one canonical symbol; exact-id batches
reject duplicates.

The inline route replaces the complete marker-bounded managed sprite. If a later
run would remove symbols, first prove their consumers are gone and then pass
`--allow-symbol-removal`. Otherwise Armorial closes before mutation. A failed
consumer patch does not invalidate an unchanged completed sprite; reuse it.

## Patch and verify consumers

- Update references to `<relative.svg>#<prefix><canonical-slug>` or local
  `#<prefix><canonical-slug>` from the returned mapping.
- Never print, read, diff, or edit generated geometry.
- Preserve layout, colors, hover/pressed/focus behavior, animation, labels,
  control semantics, conditional inclusion, and unrelated assets.
- Do not replace a missed icon with a text glyph.
- Verify every used `<use>` resolves, every visible consumer has nonzero
  geometry, and unused generated symbols are absent. Keep browser verification
  compact: return counts and failing ids unless a wider page diagnosis is
  independently necessary.
