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

## Use the release archive

Download the macOS arm64 archive and its `.sha256` file from
[GitHub Releases](https://github.com/tetracoralla/armorial/releases/latest).
In the download directory, verify and unpack the matching files:

```sh
shasum -a 256 -c armorial-0.8.0-codex-plugin-macos-arm64.tar.gz.sha256
tar -xzf armorial-0.8.0-codex-plugin-macos-arm64.tar.gz
node armorial/dist/adapters/cli.js select search settings close
```

Configure an MCP client to run `node` with the absolute path to
`armorial/dist/adapters/mcp.js`. A plugin-aware host can import the unpacked
`armorial` directory through its supported plugin installation route; do not
copy files into an update-managed cache. Host installation and discovery depend
on that host's current capabilities.

This archive includes the embedded picker, CLI and MCP server. For the standalone
web workbench or Figma development plugin, use the source build; the
[hosted workbench](https://tetracoralla.github.io/armorial/) needs no installation.

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
