# Verification map

Use this map to find tests relevant to a change. It is not a prescribed review
sequence or a claim that unlisted behavior is safe. Follow affected callers and
real user tasks; preserve a discovered defect as a regression where useful.

| Behavior | Starting points |
| --- | --- |
| Meaning, policy, ambiguity, English/Chinese ranking | `test/kernel.test.ts`, `test/search-semantics.test.ts`, `test/select-icons.test.ts` |
| Exact metadata selection without rendering | `test/select-icons.test.ts`; compare `selectIcons` with `resolve` |
| SVG geometry, determinism, colors and byte bounds | `test/provider.test.ts`, `test/svg.test.ts`, `test/policy-schema.test.ts` |
| CLI and MCP input, partial results, catalog and complete response bounds | `test/cli.test.ts`, `test/mcp.test.ts`, `test/stdio.test.ts`, `scripts/probe-built-runtime.mjs` |
| File output, HTML admission, races, cancellation and uncertain effects | `test/html-carrier.test.ts`, `test/cli.test.ts`, `scripts/probe-inline-*.mjs`, `scripts/probe-publication-*.mjs`, `scripts/probe-pinned-publication.mjs`, `scripts/probe-publish-parent-cancellation.mjs` |
| Search, selection, appearance, export, sharing, recovery and narrow layout | `test/e2e/workbench.spec.ts`, `test/e2e/fluid-layout.spec.ts`, `test/icon-link.test.ts`; inspect the built browser |
| Artifact consumers and rendered geometry | `test/e2e/inline-artifact.spec.ts`; exercise the changed output in its actual consumer |
| Figma insertion, component/layer shape and settings | `test/figma-*.test.ts`, `scripts/probe-figma-*.mjs`; use a disposable page for actual Figma changes |
| Distribution, licenses and source-pinned Pages | package scripts `plugin:check`, `release:plugin:check`, `registry:package:probe`, `pages:check`, `pages:deployment:check` |

`npm run check` runs development regressions. Browser interaction runs separately
with `npm run ui:e2e`. Use package probes when changing distributed behavior;
local build success does not attest to a currently installed or published copy.

For Agent task fit, distinguish explicit tool invocation from natural adoption.
A useful scenario starts with a UI request, makes the installed capability
available without naming it in the request, and observes selection, integration,
rendered quality, and recovery. Compare with the project's existing route when
relevant. A tool-call count or instruction-text assertion does not establish
quality, adoption, or why an Agent chose another route.
