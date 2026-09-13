# Codex plugin runtime

`npm run release:plugin` builds a macOS arm64 archive containing the plugin
manifest, Skill, MCP/CLI runtime, MCP App, production dependencies, policy
schema/example, licenses and SBOM. It does not bundle Node; the installation
needs Node 22 or newer. Agent Host can bind the plugin to its managed Node.
A normal MCP client can also launch the built server without Agent Host.

Verify the adjacent SHA-256 checksum before installing an archive. A checksum
identifies those bytes; independent dependency installations are not claimed to
produce byte-identical archives. Start a fresh consumer session after changing
a plugin binding and inspect what that session actually exposes.

The server key is `icon_svg_select`. It exposes `select_icons`, `resolve_icon`,
`search_icons`, `get_icon`, `get_icons`, and `choose_icon` to models;
`browse_icons` is an app-only helper. An older installed version may omit
`select_icons`; existing resolve/search/get routes remain available.

The operator selects a policy through `ICON_SVG_SELECT_POLICY` or server launch
configuration, not a tool argument. Use an absolute policy path when the host
starts from the plugin directory. Host projections may supply a version-bound
`scripts/armorial` launcher beside the Skill, including when MCP is inactive.
The runtime does not require the caller to locate a development checkout.

## Build and probe

- `npm run plugin:check` assembles and probes a local staged package.
- `npm run release:plugin:check` builds and probes the immutable archive.
- `npm run registry:package:probe` checks the npm-shaped package in isolation.

These are local build/validation operations, not publication or live installation.
The immutable builder omits first-party source/tests, development tools, Figma
and standalone web assets, maps and lockfiles. Third-party declarations, source
and exact test/spec payloads are removed only where current Node production
entry points do not require them. Licenses, manifests, and protected runtime
helpers remain. The build report identifies protected conditions and retained
paths; a file containing “test” in its name is not automatically disposable.

File effects, uncertainty and recovery are specified once in the shipped
[artifact guide](../skills/icon-svg-select/references/artifact-output.md).
Package probes exercise those behaviors against the actual packaged executable.
