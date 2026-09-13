# Delivering icons into an artifact

Use the installed `scripts/armorial` launcher when supplied, an available
`armorial` CLI, or your deliberately built installation. The commands below use
`armorial` as that executable. Work from the consuming project's directory.

## File and HTML examples

```sh
# Select several meanings and create a same-origin sprite; no SVG in stdout.
armorial batch search settings close --resolve-intents --output icons.svg

# Add a sprite to a distinct HTML candidate without changing the source.
armorial batch icon-park:search icon-park:setting --inline-from page.html --output page.icons.html
```

`--format json` is accepted with either file route and returns a compact summary.
Both outputs are create-only by default. An existing path is preserved, including
hard-link aliases. A batch with unresolved meanings writes nothing and returns
successful mappings plus all unresolved entries and bounded candidates. Keep
those mappings; resolve the remaining meanings before publishing the complete set.
There are at most 20 inputs per CLI batch. Larger tasks can use several deliberate
asset groups. A generated sprite uses `armorial-<canonical-slug>` symbol ids;
`--symbol-prefix` changes that prefix.

For served HTML, reference `<use href="icons.svg#armorial-search">`. For a
self-contained HTML candidate, use `<use href="#armorial-search">`.
Give the consuming `<svg>` dimensions and appropriate accessibility. Symbols do
not own their final size, so sprite mode rejects `--size`. Check actual rendering
in the destination; external SVG use may be restricted across origins or under
`file://`, where the inline candidate is useful.

Preserve the surrounding interaction, layout, labels, and conditional states.
When retrofitting a page, include mobile, disclosure, close, state, and empty-state
icons that the change affects. Keep unrelated logos, illustrations, and favicons.
Generated geometry can be inspected to diagnose integration; preserve the provider
paths when editing consumers. Check reference resolution and visible geometry,
and avoid shipping unused symbols. Reuse an unchanged generated file across a
consumer-patch retry.

## Appearance

CLI flags mirror the MCP `render` object: `--theme`, `--size`, `--stroke-width`,
`--stroke-linecap`, `--stroke-linejoin`, `--primary`, `--secondary`, `--inner-stroke`,
and `--inner-fill`. Stroke weight is IconPark's integer 1–4 scale. Use colors or
`currentColor` as appropriate; the response identifies an explicit policy override.
Policy resolution is `--policy`, then `ICON_SVG_SELECT_POLICY`, then the working
directory's `icon-policy.json`, then built-in defaults.

## File effects and recovery

- New SVG output reports `non_overwriting_create`; HTML candidates report
  `non_overwriting_candidate`. The source is unchanged. Hashes identify the
  source and output bytes, not an atomic permission to replace another file.
  Reacquire the source before adopting a candidate if it may have changed.
- Replacing an existing SVG or using legacy `--inline-into` requires explicit
  `--allow-optimistic-overwrite`. A concurrent editor save can be overwritten
  after the final check; successful output reports `optimistic_preflight_only`
  and `concurrencyWarning`. Prefer a new output and the project's normal edit
  workflow. Do not hide the warning when this mode is deliberately used.
- After any interrupted call or `PUBLICATION_OUTCOME_UNCERTAIN`, inspect the
  intended destination before retrying. Missing stdout does not prove no write.
- `cleanupWarning` on success means the final output exists. A cleanup failure
  can leave a private `.armorial-publish-*.tmp` sibling; inspect the destination
  and reported residue before removal. The error retains its original cause
  and structured publication/cleanup state.
- Output stays within the working directory. Choose a portable basename within
  255 UTF-8 bytes. New SVG permissions respect umask; candidates inherit source
  mode. HTML accepts one explicit body, up to 8 MiB of caller content and a
  separate 512 KiB managed block. Rejection leaves existing files unchanged.

Exit 2 means invalid input or unresolved selection; exit 1 means internal failure
or uncertain publication. `select` partial results use stdout; legacy batch
failure reports use stderr. Correct the stated issue or inspect the destination
as appropriate, rather than retrying blindly.
