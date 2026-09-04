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

Use one bounded intent batch rather than one resolver process per icon:

- same-origin served artifact:
  `scripts/armorial batch <compact-intent...> --resolve-intents --format json --symbol-prefix <safe-prefix> --output <task-local-relative.svg>`
- single-file or direct `file://` artifact:
  `scripts/armorial batch <compact-intent...> --resolve-intents --format json --symbol-prefix <safe-prefix> --inline-from <source-relative.html> --output <new-candidate-relative.html>`

The command returns a compact mapping and integrity summary without printing
SVG. It writes nothing when any intent is ambiguous or missing, reports all
resolved mappings plus every unresolved intent, and bounds candidate ids. Keep
the resolved mappings, refine only unresolved meanings, then rerun one corrected
union batch. Intent batches may share one canonical symbol; exact-id batches
reject duplicates.

The file/inline flag selects the sprite carrier. `--format json` describes the
compact stdout summary and is optional; `--format sprite` remains a supported
compatibility spelling.
The external SVG path must be new by default. Do not replace an existing sprite
unless the caller explicitly accepts `--allow-optimistic-overwrite`; that
replacement can overwrite a non-cooperating save in the final check-to-rename
window, so repeat the returned `protectionLevel: optimistic_preflight_only` and
`concurrencyWarning`. Prefer a new versioned path and patch consumers to it.
Do not pass `--size` to a sprite batch. SVG symbols have no final rendered
size; preserve or set width/height on each consuming `<svg>` element instead.

The HTML route creates a new candidate containing the complete marker-bounded
managed sprite. It never modifies the source and never replaces an existing
output. The candidate must be a distinct path and not a hard-link alias of the
source. If a later candidate would remove symbols, first prove their consumers
are gone and then pass `--allow-symbol-removal`; otherwise Armorial closes
before publication. A failed consumer patch does not invalidate an unchanged
completed candidate; reuse it.
Caller-owned HTML is bounded to 8 MiB. The managed marker block is separately
bounded to 512 KiB plus four canonical framing bytes, so every accepted first
insert remains admissible for an exact retry or replacement; do not strip or
recreate the markers to work around the carrier limits. The JSON result reports
`sourceSha256`, `candidateSha256`, and
`protectionLevel: non_overwriting_candidate`. These hashes identify the bytes
used and produced; they are not an atomic commit credential. If another editor
saves the source during generation, its save remains untouched and the
candidate still corresponds to the reported source hash. Reacquire the source
before adopting the candidate.
The managed launcher pins publication to the admitted output-directory inode.
If that parent path changes before publisher startup, treat the resulting
`INVALID_INPUT` as a closed carrier and reacquire the task path; do not bypass
it with a shell write or by following the replacement symlink.
Use a portable destination basename with no backslash and at most 255 UTF-8
bytes.
The publisher stages and verifies the candidate before asking its still-live
CLI parent for a one-use commit. Parent cancellation or timeout before that
authorization creates no candidate and normally removes private staging. If
destination-parent permissions prevent cleanup, the surviving CLI preserves
the cause and reports bounded publication effect, cleanup, and `0600` residue
metadata. Restore access and inspect/remove that sibling before retrying. After commit
authorization, an interruption may leave the candidate present without a
success summary. Inspect the candidate path and bytes before retrying any
interrupted or `PUBLICATION_OUTCOME_UNCERTAIN` call; never treat missing stdout as proof
that publication did not happen. A helper crash between create-only hard-link
publication and cleanup may leave a private `.armorial-publish-*.tmp` sibling;
verify the candidate destination before treating that private name as stale.

Do not use the legacy in-place route unless the caller explicitly accepts its
remaining race:

`scripts/armorial batch <compact-intent...> --resolve-intents --format json --symbol-prefix <safe-prefix> --inline-into <relative.html> --allow-optimistic-overwrite`

That route is only an optimistic preflight. Although it rechecks identity,
metadata, and bytes, a non-cooperating editor can save after the last check and
before rename, and that save can be overwritten. A successful result reports
`protectionLevel: optimistic_preflight_only` and a `concurrencyWarning`. Never
invoke this mode by default, and never omit that residual risk when reporting
the result.

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
