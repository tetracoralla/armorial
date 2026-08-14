---
name: icon-svg-select
description: Select and render existing policy-compliant IconPark SVG icons for product UI work. Use when an Agent needs an icon, should not draw SVG geometry, must follow a project icon policy, needs alternatives, or the human asks to choose visually or rejects an earlier icon choice.
---

# Icon SVG Select

Use the installed tools as the only icon geometry and policy authority. Never redraw, approximate, or silently edit returned paths.

## Route the request

1. For an ordinary semantic request, call `resolve_icon` once with the user's intent and known surface context.
2. If the user asks for alternatives, call `search_icons`, present the compact candidates, and call `get_icon` only after an exact id is chosen.
3. If the user explicitly wants to choose visually, rejects the prior choice, or taste is the remaining ambiguity, call `choose_icon` once. Tell the user to choose in the picker, then stop and wait for its explicit `icon_selection` message.
4. For an already-known id, call `get_icon`. For independent exact ids, call `get_icons` once.

Do not open the picker for every routine request. It is a human decision return path, not a mandatory approval ceremony.

## Continue from a human selection

When the conversation receives an `[icon-selection:v1]` message:

- treat its `iconId` as the human's exact choice for `scope: current_task`;
- call `get_icon` with that id and the stated non-null context, if any;
- compare the returned asset hash with `assetSha256`;
- if they match, use that SVG and continue the already-authorized task without re-searching or asking the user to repeat the choice;
- if they do not match, report a policy or version mismatch and ask whether to use the current rendered asset. Do not ignore the mismatch or redraw the icon.

The selection message does not authorize unrelated work, external writes, or a different task.

## Keep the human surface simple

Present icon name, useful meaning, and the resulting asset. Keep raw schemas, protocol metadata, hashes, and capability detail secondary unless a mismatch changes the decision.

If the tools are unavailable, say so plainly. Do not substitute model-authored SVG as a fallback.
