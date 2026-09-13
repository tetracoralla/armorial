# Working on Armorial

Armorial helps people and Agents choose existing icons and use them in a UI.
Read the current request and affected implementation first. For product context,
see [docs/PRODUCT_MODEL.md](docs/PRODUCT_MODEL.md). The review map in
[docs/REVIEW_CONTRACT.md](docs/REVIEW_CONTRACT.md) points to useful checks;
choose coverage from the change and the actual user flow.

## Engineering boundaries

- `src/core/kernel.ts` owns selection, search, policy, and rendering. Adapters
  translate CLI, MCP, browser, and Figma interactions into that shared behavior.
- The current provider is pinned IconPark. Preserve its geometry and provenance
  when producing an Armorial asset; do not silently substitute another library.
- Deterministic selection reports its basis and unresolved candidates. The
  caller can interpret the task, compare candidates, and choose an exact id.
  Engine ambiguity is not a requirement to ask the owner about ordinary design.
- Appearance overrides layer over project defaults/context and report
  `overridden` when they change policy values. Output is bounded, deterministic,
  and free of scripts, external references, and event handlers.
- MCP inputs are closed domain data. Local file access belongs to CLI/server
  setup, not arbitrary paths or executable content in tool arguments.
- Generate `icon-policy.schema.json` from `IconPolicySchema`; check schema drift.

## Verification and records

Exercise the affected entry point and the result in its consumer. `npm run check`
is the development regression suite; `npm run ui:e2e` covers browser interaction.
Packaging changes need the matching package probe. A UI change needs rendered
inspection as well as assertions. A discovery claim needs a fresh consumer task;
explicit invocation alone proves only invocation.

Keep public documentation useful to users and contributors. Private plans,
historical review transcripts, local captures, and handoffs belong in ignored
`.task-notes/`. Preserve useful failure cases as executable tests or focused
technical references, not accumulating mandatory procedures. Do not test that
an Agent guide contains a prescribed phrase or thinking sequence.

Review-only work stays read-only unless repairs are requested. Preserve unrelated
work; staging, committing, installing, and publishing follow the user's authority.
This file does not commission other Agents or restrict future product direction.
