# Armorial Codex plugin runtime

This document applies to the minimal macOS arm64 Codex-plugin archive produced
by `npm run release:plugin`. It is a local plugin payload, not an npm package
to install or a request to run lifecycle scripts.

## Runtime binding

The archive contains Armorial's production JavaScript dependencies. It does
not contain a Node.js executable. Its `.mcp.json` deliberately declares
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
configuration, product Skill, MCP runtime/core, MCP App picker, production
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
