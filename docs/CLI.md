# CLI and library use

Use an installed `armorial` command, a Host-supplied Skill launcher, or
`node /absolute/path/to/armorial/dist/adapters/cli.js` after building from source.
The CLI works without MCP or Agent Host. Run `--help` for current arguments.

## Choose before rendering

```sh
armorial select search settings close
armorial select 搜索 关闭 --format text
armorial select settings --policy icon-policy.json --context toolbar
```

`select` and library `kernel.selectIcons({intents:[...]})` accept 1–20 meanings.
They do not render SVG. JSON contains `status: ok|partial|error`; successful and
unresolved items preserve input order and index. Each choice reports id, name,
title and selection method. Policy, override status and warnings appear once.
Partial output retains successful choices and candidates for each ambiguity.
Use task context to choose a candidate, refine a meaning, or compare visually.
A partial selection exits 2 with its result on stdout; invalid input exits 2 with
an error on stderr. The MCP equivalent is `select_icons`.

```sh
armorial search notification --limit 8 --format json
armorial get icon-park:remind --format svg
armorial resolve search --format svg
```

`resolve` includes SVG on success; `search` returns metadata candidates;
`get` renders an exact id. `resolve --format text` suppresses SVG in stdout but
still renders internally, so use `select` when geometry is not needed.

## Files and appearance

[Artifact output](../skills/icon-svg-select/references/artifact-output.md) is the
shared CLI/Skill guide to sprites, HTML candidates, appearance flags, file effects,
and recovery. It includes create-only defaults and explicit legacy replacement.

`batch --resolve-intents` retains its compact `icon_intent_batch` response for
existing consumers. With no file carrier it selects metadata; with a carrier it
renders the completed id set. Legacy batch failures use stderr and include all
resolved and unresolved meanings; a schema-invalid intent (empty or longer than
120 characters) instead closes the whole batch before any mapping is produced.
`select` has the uniform indexed item shape.

## Policy and MCP

```sh
armorial policy validate icon-policy.json
armorial policy schema
armorial mcp --policy icon-policy.json
```

The schema is generated from the executable policy model. Validation also checks
referenced icons and duplicate normalized semantic keys. MCP tools do not accept
paths or SVG; policy is loaded at server startup.

The library exports `IconKernel`, input/output schemas and their TypeScript
types. Selection, search and rendering share the same implementation:

```js
import { IconKernel } from "armorial";
const icons = new IconKernel();
const choices = icons.selectIcons({ intents: ["search", "settings"] });
const asset = icons.getIcon({ id: "icon-park:search", render: { size: 32 } });
```

These package imports assume a locally installed/built package; public npm
publication is separate. Runtime bounds and closed schemas are defined in
`src/core/contracts.ts`, not by the number of examples in this guide.
