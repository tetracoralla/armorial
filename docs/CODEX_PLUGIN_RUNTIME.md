# Armorial Codex plugin runtime

This document applies to the minimal macOS arm64 Codex-plugin archive produced
by `npm run release:plugin`. It is a local plugin payload, not an npm package
to install or a request to run lifecycle scripts.

## Runtime binding

The archive contains Armorial's production JavaScript dependencies and both
its MCP and direct CLI adapters. It does not contain a Node.js executable. Its `.mcp.json` deliberately declares
`command: "node"`; the Agent Host binds that command to the Node runtime it
already manages. Installation therefore needs a macOS arm64 Agent Host whose
MCP launch environment provides `node`. No `npm install`, registry access, or
post-install hook is needed after unpacking.

The release build itself is permitted only on macOS arm64 and verifies that
the packaged production tree contains no native `.node` addon. The JavaScript
payload is consequently tied to the host's Node runtime rather than to a
vendored Node binary.

## Contents and verification

The archive root is `armorial/` and contains only the Codex manifest, MCP
configuration, product Skill, MCP and CLI runtime/core, MCP App picker, production
dependencies, icon-policy schema/example, `LICENSE`, `NOTICE`, third-party
notices, and `SBOM.spdx.json`. It intentionally excludes TypeScript source,
tests, build tooling, Figma files, standalone web-server assets, source maps,
package lockfiles, and npm command shims.

Verify the adjacent `.sha256` file before unpacking. Then install the
`armorial/` directory through the host's normal local-plugin mechanism and
start a fresh host session. The expected server is `icon_svg_select`, with the
five model-facing tools `resolve_icon`, `search_icons`, `get_icon`,
`get_icons`, and `choose_icon`; `browse_icons` remains MCP-App-only.

`ICON_SVG_SELECT_POLICY` is the only plugin environment variable. It is an
operator-selected policy path, not an MCP tool argument.

Agent Host may project the plugin without its MCP declaration when Armorial is
installed but not in the active tool set. In that form the product Skill and a
Host-generated `scripts/armorial` launcher remain available. The launcher is
bound to this archive's exact CLI bytes and the Host-managed Node runtime; it
does not discover or execute a mutable source checkout. Its task-local sprite
routes support either a same-origin external SVG file or marker-bounded inline
insertion into an existing HTML file, without returning geometry to the Agent.
The CLI can deterministically resolve up to 20 compact intents and publish that
carrier in one process; ambiguities or misses close before file mutation and
return all resolved mappings plus every unresolved intent and bounded candidate
ids rather than stopping at the first failure or publishing a partial sprite.
An explicit `--format json` remains valid with a file or inline carrier because
the carrier selects the sprite while stdout returns its compact integrity
summary. Typed appearance flags feed the same validated core render override
as MCP, Web, and Figma. Sprite routes reject `--size`; each consuming `<svg>`
owns its final width and height.

The inline carrier accepts caller-owned valid UTF-8 up to 8 MiB with one
explicit HTML body. Its Armorial-managed marker block is separately bounded to
512 KiB plus four canonical framing bytes, for an 8,912,900-byte physical
carrier ceiling; a successful first insert therefore remains valid for exact
retry or replacement. Its runtime parsing boundary is 5 seconds, 50,000
structural nodes, 50,000 attributes, 256 simultaneously open elements, 2 MiB
of retained attribute data, and 64 Ki UTF-16 code units per lexical token. The
immutable-package probe repeats the fresh-process 1, 4, 7.5, and 8 MiB resource
check against a 6-second / 256 MiB max-RSS regression boundary.
