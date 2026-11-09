---
'agent-facets': minor
---

Add `facet info` and `facet cat`. `facet info <name>` summarizes an installed facet: its description and author, every skill, command, agent, and MCP server with its description, any alias or omission from `facets.json`, declared files, and the `facet cat` command for each. `facet cat <name> <asset-or-path>` prints one skill, command, agent, or declared file exactly as installed, or its location with `--path`. Both read the verified local copy and never contact the registry, and both show facet text with terminal control characters made visible.
