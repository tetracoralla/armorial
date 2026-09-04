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
notices, and `SBOM.spdx.json`. It intentionally excludes Armorial first-party
TypeScript source, tests, build tooling, Figma files, standalone web-server
assets, source maps, package lockfiles, npm command shims, and production test
hooks. The release builder also removes third-party TypeScript declarations
(`.d.ts`, `.d.cts`, and `.d.mts`), non-declaration TypeScript source, and exact
test/spec directories or filenames unless a current package `main`, `module`,
`bin`, `imports`, or Node production `exports` target protects that file. The
protected condition set is reported and fixed to `node`, `node-addons`,
`module-sync`, `import`, `require`, and `default`; opt-in source, types,
development, browser, Deno, or Bun branches are not Host runtime targets.
Licenses and manifests remain. Public runtime paths with test-like names remain
too: current examples include React's `test-utils`, Hono's `helper/testing`,
and the runtime package named `@standard-schema/spec`. Release/probe JSON
reports declaration, source, test-suite, protected-runtime, retained-helper,
entry, unpacked-byte, and archive-byte counts/paths rather than claiming that
every dependency contains no source- or test-named runtime file.

Verify the adjacent `.sha256` file before unpacking. Then install the
`armorial/` directory through the host's normal local-plugin mechanism and
start a fresh host session. The expected server is `icon_svg_select`, with the
five model-facing tools `resolve_icon`, `search_icons`, `get_icon`,
`get_icons`, and `choose_icon`; `browse_icons` remains MCP-App-only.

The checksum identifies this exact archive. The current builder does not claim
that a later independent `npm ci` and tar invocation will reproduce identical
archive bytes; release verification must use the checksum beside the artifact
being installed.

`ICON_SVG_SELECT_POLICY` is the only plugin environment variable. It is an
operator-selected policy path, not an MCP tool argument.

Agent Host may project the plugin without its MCP declaration when Armorial is
installed but not in the active tool set. In that form the product Skill and a
Host-generated `scripts/armorial` launcher remain available. The launcher is
bound to this archive's exact CLI bytes and the Host-managed Node runtime; it
does not discover or execute a mutable source checkout. Its task-local sprite
routes support either a same-origin external SVG file or a marker-bounded HTML
candidate created from an existing file, without returning geometry to the
Agent. New SVG and HTML candidate outputs are create-only by default; a new SVG
reports `protectionLevel: non_overwriting_create`. Replacing
an existing SVG requires `--allow-optimistic-overwrite`; every successful
replacement reports `protectionLevel: optimistic_preflight_only` and a
`concurrencyWarning` because a non-cooperating writer can still save in the
final check-to-rename window. A new SVG rejects that replacement-only flag and
leaves no output. New SVG permissions use a `0644` default narrowed
by the caller's umask, while an explicit replacement preserves the admitted
target mode. The default HTML route never changes its source
and never replaces an existing output. The CLI can deterministically resolve up to 20 compact intents
and publish that carrier in one process; ambiguities or misses close before
publication and
return all resolved mappings plus every unresolved intent and bounded candidate
ids rather than stopping at the first failure or publishing a partial sprite.
An explicit `--format json` remains valid with a file or HTML carrier because
the carrier selects the sprite while stdout returns its compact integrity
summary. Typed appearance flags feed the same validated core render override
as MCP, Web, and Figma. Sprite routes reject `--size`; each consuming `<svg>`
owns its final width and height.

The safe HTML carrier uses `--inline-from <source.html> --output
<new-candidate.html>`. It rejects the same resolved path, a hard-link alias, or
an existing output. Its result reports `sourceSha256`, `candidateSha256`, and
`protectionLevel: non_overwriting_candidate`; these hashes identify bytes and
are not atomic commit credentials.

The packaged CLI includes a small publication helper. The host launches it
with the already-realpathed output parent as its working directory and the
expected directory device/inode. It verifies that identity before any write
and then uses relative basenames only, so replacing the parent path cannot
redirect SVG, candidate, or explicit optimistic HTML bytes through a new
symlink. Default SVG and candidate publication remain create-only; helper input and responses
are bounded, and completed temporary bytes are fsynced and read back before
publication. Portable destination basenames contain no backslash and are
limited to 255 UTF-8 bytes. The helper's
short random exclusive temporary basename does not incorporate the destination;
an overlong destination closes as `INVALID_INPUT`, and cleanup runs only after
the helper actually created a temporary file.

The helper prepares, fsyncs, reads back, closes, and rechecks its private
temporary bytes before sending bounded readiness over IPC. A close failure
therefore has no final-path effect. It publishes only after the still-live CLI
parent returns the matching one-use commit token. Parent-only cancellation or
the five-second parent deadline before that token leaves no final output and
normally cleans the temporary file. If the pinned destination parent loses
unlink permission, a surviving CLI preserves the original cause and reports
bounded `publication.effect`, cleanup, and private-residue metadata. Pre-commit
staging remains `0600`; restore parent access and inspect/remove the reported
sibling before retrying. After the token is accepted, publication is
authorized: a host interruption can then leave the final output present before
the CLI returns its success JSON. A surviving CLI reports an indeterminate
post-commit result as `PUBLICATION_OUTCOME_UNCERTAIN`. Inspect the destination
before retrying any interrupted or explicitly uncertain carrier call. A create-only helper crash
between final hard-link creation and cleanup may also leave its private sibling
link; verify the intended destination before treating that residue as stale.
If create-mode publication succeeds but removing its private hard-link name
genuinely fails, the result remains successful and includes `cleanupWarning`;
the reported hash and protection level still describe the committed output.

HTML input accepts caller-owned valid UTF-8 up to 8 MiB with one explicit body.
Its Armorial-managed marker block is separately bounded to
512 KiB plus four canonical framing bytes, for an 8,912,900-byte physical
carrier ceiling; a successful first insert therefore remains valid for exact
retry or replacement. Its runtime parsing boundary is 5 seconds, 50,000
structural nodes, 50,000 attributes, 256 simultaneously open elements, 2 MiB
of retained attribute data, and 64 Ki UTF-16 code units per lexical token. The
immutable-package probe repeats the fresh-process 1, 4, 7.5, and 8 MiB resource
check against a 6-second boundary and a conservative 256 MiB aggregate-RSS
boundary formed by adding the parent and publisher process maxima.

The legacy in-place route requires `--inline-into <target.html>
--allow-optimistic-overwrite`. It is not atomic compare-and-swap: a
non-cooperating editor save in the final check-to-rename window can be
overwritten. Every successful result reports
`protectionLevel: optimistic_preflight_only` and a `concurrencyWarning`; the
Skill must not select or describe that mode as the default.
