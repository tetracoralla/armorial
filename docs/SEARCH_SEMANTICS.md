# Internal search semantics

Armorial keeps a sparse, deterministic semantic overlay in
`src/core/search-semantics.json`. The overlay improves recall without changing
the IconPark metadata, returning prose descriptions, or adding a model call to
the runtime path.

## Acceptance boundary

A term may enter the overlay only when it is a short, visually defensible
meaning or stable UI convention of the rendered icon and adds recall beyond
the pinned provider name, title, category, and tags. Brand inference, hidden
workflow context, generic UI words, and merely plausible guesses are omitted.
When one conventional intent has several visually plausible icons, the term is
attached to each reviewed option so resolution stays explicitly ambiguous.

Model-assisted annotation is an offline proposal step, not product authority:

1. Render the exact pinned IconPark geometry into contact sheets.
2. Produce sparse candidate terms from visual inspection.
3. Independently review the proposed terms against the rendered icons.
4. Keep only reviewed terms, then run `npm run search-semantics:check` and the
   search regression corpus.

The checked data is bounded to six normalized terms per icon and 192 KiB for
the complete encoded overlay. A term may map to multiple icons; those matches
remain tied so the deterministic resolver reports ambiguity instead of
inventing a preference.
