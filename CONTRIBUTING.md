# Contributing to Armorial

This repository's working contract lives in [AGENTS.md](./AGENTS.md): one
deterministic kernel, adapters that only translate transport, and acceptance
lanes instead of prose claims. Changes are expected to keep that shape.

## Development loop

```sh
npm install
npm run check
```

`npm run check` runs type checks, tests, policy-schema drift detection, the
production builds, a fresh-process probe of the built CLI and stdio MCP
server, and an offline Figma bundle/UI/drag probe.

For a focused Figma loop:

```sh
npm run build:figma
npm run figma:probe
```

Import `figma-plugin/manifest.json` with Figma Desktop's development-plugin
flow. Keep generated `figma-plugin/dist/` files out of Git; `prepack` rebuilds
and includes them in the npm package.

The browser regression lane runs separately:

```sh
npx playwright install chromium
npm run ui:e2e
```

## Change expectations

- Search, policy, rendering, and selection-decision rules belong in
  `src/core`; CLI, web UI, MCP, and Figma are adapters over `IconKernel`.
- Every parser, guard, or failure-path fix ships with the smallest negative
  regression test that fails if the fix is reverted.
- `icon-policy.schema.json` is generated; run `npm run schema:generate` after
  changing `IconPolicySchema`, never edit the JSON by hand.
- Do not redraw or mutate IconPark geometry; the pinned provider owns it.
