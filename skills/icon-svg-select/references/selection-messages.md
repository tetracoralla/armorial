# Human selection messages

Read this only after the conversation receives an Armorial
`[icon-selection:v3]`, `v2`, or `v1` message.

## Version 3

- Treat `iconId` as the human's exact choice for `scope: current_task`.
- Call `get_icon` with that id, the message's `render` object, and its stated
  non-null context when present. `render` already includes picker adjustments.
- Compare the returned asset hash with `assetSha256`.
- On a match, use that SVG and continue the already-authorized task without
  searching again or asking the user to repeat the choice.
- On a mismatch, report a policy or version mismatch and ask whether to use
  the current rendered asset. Never ignore the mismatch or redraw the icon.

## Legacy versions

A v2 message uses the former rendered-pixel stroke scale. Do not reinterpret
its `strokeWidth` as a current IconPark weight. Call `get_icon` only as a
guarded reproduction attempt and compare the returned hash. On mismatch,
report the version mismatch and ask whether to use the current rendered asset.

A v1 message has no `render`. Reproduce it with `get_icon` and the stated
non-null context, if any, then compare hashes the same way.

No selection message authorizes unrelated work, external writes, or a
different task.
