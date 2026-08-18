# Security policy

Icon SVG Select is a local-first tool: the web UI binds to loopback only, and
the MCP server reads one operator-selected policy file at startup. MCP tool
inputs never accept paths, URLs, raw SVG, or source code, and generated SVG is
sanitized and size-bounded.

## Reporting a vulnerability

Please report suspected vulnerabilities privately by opening a GitHub
security advisory on this repository, or contact the maintainer directly.
Do not open a public issue for suspected security problems.
