# Review contract

A current reviewer should re-run the source and runtime checks rather than accept this document as proof.

Product-specific adversarial sequences:

1. Search an exact English name and a Chinese title/tag; verify deterministic order and bounded results.
2. Resolve a tied Chinese intent without a semantic policy choice; verify no SVG is invented or arbitrarily selected.
3. Add a policy semantic selection; verify exact and ordinary English/Chinese phrasing resolve to it in one core/MCP call with the context style applied, while a multi-semantic intent does not get swallowed by the pin.
4. Render the same icon twice; verify byte-for-byte identical SVG even for icons that use internal ids.
5. Supply an SVG-breaking color, unknown policy field, duplicate normalized semantic key, unknown icon id, oversized query, and oversized batch; verify stable pre-render failures.
6. Render every IconPark metadata entry once; verify every entry maps to a renderer and generated output contains no script, event handler, external URL, or unbounded payload.
7. Execute the MCP server over stdio; verify five model-visible tools plus one `app`-only helper, run success, ambiguity, per-item batch failure, and visual-picker paths, and read the bounded MCP App HTML resource.
8. Launch the built CLI and MCP entry points through package-style symbolic links, including a path containing spaces; verify both processes actually start and the direct tools execute.
9. Run repeated hot semantic searches over the full pinned corpus and enforce the current runtime latency budget.
10. Launch the built local UI on loopback; search, select a non-default result, copy SVG, download, inspect drag transfer types, and verify Copy for Agent contains the canonical id and hash but no SVG.
11. In an Agent-hosted MCP App, verify grid selection sends nothing, Attach only updates context, Select & continue sends one user-role decision message, and a host rejection retains the selected icon plus Copy for Agent recovery.
12. At a narrow viewport, verify category navigation remains reachable, the grid and inspector remain usable, and the page has no horizontal overflow.
13. Pass a per-call `render` override through resolve, get, batch, and browse (core and MCP); verify it layers over the context policy, the result reports the final effective style, deterministic bytes stay deterministic, and invalid render values fail before rendering. Copy a decision after picker adjustments and verify `get_icon` with the decision's `render` reproduces the exact `assetSha256`; verify Reset returns the policy-rendered asset.
