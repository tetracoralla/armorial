# Changelog

## 0.7.0

- Breaking: SVG `--output` is create-only by default. Replacing an existing
  sprite now requires `--allow-optimistic-overwrite` and reports
  `protectionLevel: optimistic_preflight_only` plus the final check-to-rename
  concurrency warning. A new SVG rejects that replacement-only flag without
  creating an output.
- Breaking: inline HTML publication is fail-closed by default. Use
  `--inline-from source.html --output candidate.html` to create a new,
  non-overwriting candidate while leaving the source unchanged.
- Breaking: the legacy `--inline-into target.html` mutation now requires the
  explicit `--allow-optimistic-overwrite` acknowledgement. It remains an
  optimistic preflight, not an atomic compare-and-swap: a non-cooperating
  editor can save in the final check-to-rename window and be overwritten.
- Inline candidate summaries now report `sourceSha256`, `candidateSha256`, and
  `protectionLevel`. These hashes identify bytes; they are not atomic commit
  credentials.
- SVG and HTML publication now runs through a bundled helper whose cwd is
  pinned to the admitted parent directory inode. Parent-path replacement can
  no longer redirect publication through a new symlink.
- Publication now uses an IPC preparation/commit handshake. Parent death or
  the five-second CLI deadline before commit authorization creates no final
  output and normally cleans private staging. A real destination-parent
  permission loss now preserves the original cause and reports bounded
  publication effect, cleanup, and private `0600` residue state instead of
  hiding the surviving sibling. An interruption after authorization may
  leave a valid output without a success summary; a surviving CLI reports
  `PUBLICATION_OUTCOME_UNCERTAIN`, and callers must inspect the destination
  before retrying an interrupted carrier call.
- Publication now accepts portable destination basenames without backslashes
  through 255 UTF-8 bytes by using a short destination-independent exclusive temporary name. A
  256-byte basename closes as `INVALID_INPUT`, and cleanup cannot replace the
  causal publication failure.
- New SVG permissions use a `0644` default narrowed by the caller's umask;
  explicit replacement preserves the admitted target mode.
- Production adapters no longer recognize test-only helper import or failure
  environment switches; race and failure injection stays in the test harness.
- The immutable plugin trims third-party `.d.ts`/`.d.cts`/`.d.mts`, remaining
  non-declaration TypeScript, and exact test/spec payload unless a Host Node
  production package target protects it. Reports expose the condition set plus
  runtime paths such as React `test-utils` and Hono `helper/testing`, while
  preserving package manifests and license material.
- Publication closes and rechecks private staging before commit authorization.
  Close failures cannot mutate the final path; a genuine cleanup failure after
  a successful create is returned as `cleanupWarning` on a truthful success.
- The workbench now binds selection actions to the query that produced the
  settled result. Pending, failed, or empty replacement searches cannot deliver
  a stale icon as the new intent.
