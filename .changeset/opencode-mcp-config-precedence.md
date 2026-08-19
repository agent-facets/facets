---
"@agent-facets/adapter-opencode": patch
---

**MCP servers now land where OpenCode actually reads them.** The adapter considered only the project root's `opencode.jsonc` and `opencode.json`, so a project keeping its OpenCode configuration in `.opencode/` — the location that *outranks* the root — had servers written to a file the higher-precedence one shadows. The configuration you approved was not the configuration OpenCode loaded.

All four documents OpenCode merges are now read, classified as one configuration, and disclosed. In decreasing precedence: `.opencode/opencode.jsonc`, `.opencode/opencode.json`, `opencode.jsonc`, `opencode.json`.

Writes go to exactly one of them, chosen once per run: the highest-precedence document that already defines an `mcp` member (an empty `{}` counts), otherwise the highest-precedence document that exists, otherwise a newly created `.opencode/opencode.jsonc`. Following the existing `mcp` member rather than merely the file that sorts first is what keeps a project whose servers live in a root `opencode.json`, beside a `.opencode/opencode.jsonc` holding only agents, from having its servers split across two files that shadow each other.

A definition of a desired server in a lower-precedence document is now left exactly as its author wrote it — the target's definition already wins, and deleting from a file this run is not otherwise writing is not the adapter's call. Previously a shadowed copy was deleted. An obsolete owned entry is still removed from **every** document that defines it, so a removal cannot promote a shadowed copy and leave the server configured. Entries the project neither desires nor owns remain untouched everywhere.
