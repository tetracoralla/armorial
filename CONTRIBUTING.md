# Contributing to Icon SVG Select

This repository's working contract lives in [AGENTS.md](./AGENTS.md): one
deterministic kernel, adapters that only translate transport, and acceptance
lanes instead of prose claims. Changes are expected to keep that shape.

## Development loop

```sh
npm install
npm run check
```

`npm run check` runs type checks, tests, policy-schema drift detection, the
production build, and a fresh-process probe of the built CLI and stdio MCP
server.

The browser regression lane runs separately:

```sh
npx playwright install chromium
npm run ui:e2e
```

## Change expectations

- Search, policy, rendering, and selection-decision rules belong in
  `src/core`; CLI, web UI, and MCP are adapters over `IconKernel`.
- Every parser, guard, or failure-path fix ships with the smallest negative
  regression test that fails if the fix is reverted.
- `icon-policy.schema.json` is generated; run `npm run schema:generate` after
  changing `IconPolicySchema`, never edit the JSON by hand.
- Do not redraw or mutate IconPark geometry; the pinned provider owns it.
