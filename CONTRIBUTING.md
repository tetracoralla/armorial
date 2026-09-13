# Contributing

Read [AGENTS.md](AGENTS.md) for the shared source boundaries and
[docs/PRODUCT_MODEL.md](docs/PRODUCT_MODEL.md) for product intent.
Keep selection, search, policy and rendering in `IconKernel`; adapters own their
transport and destination behavior. Improve an existing design when the task
and evidence justify it.

With Node.js 22 or newer:

```sh
npm ci
npm run check
```

The check includes types, behavioral tests, schema drift, builds, licenses,
fresh-process CLI/MCP, artifact publication and Pages/Figma build probes.
For browser interaction:

```sh
npx playwright install chromium
npm run ui:e2e
```

Use focused checks while developing; [the verification map](docs/REVIEW_CONTRACT.md)
helps locate affected tests. Inspect rendered UI changes and their real user
flows. Keep regression assertions about behavior and meaningful contracts;
wording or a prescribed Agent thinking sequence is not a product invariant.

Run `npm run schema:generate` when changing `IconPolicySchema`. For Figma, use
`npm run build:figma`, `npm run figma:probe`, and import the development manifest
in Figma Desktop. Generated Figma files are ignored and distributed separately
from the npm package. Package changes have their own probes documented in
[plugin runtime](docs/CODEX_PLUGIN_RUNTIME.md).

Public docs serve users and contributors. Private task notes, local captures,
review history and handoffs belong in ignored `.task-notes/`. Consolidate repeated
technical information instead of copying every failure lesson into each guide.
