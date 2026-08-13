---
"agent-facets": minor
---

**Facets can now configure MCP servers across every selected coding tool.** Concrete `stdio` and Streamable HTTP declarations in `facet.json` are translated into project-scoped `.mcp.json`, `opencode.jsonc` or `opencode.json`, and `.codex/config.toml` entries. Server-only facets install successfully without text assets, and configuration never launches, contacts, health-checks, or authenticates to a server.

**New and changed declarations require approval before anything is written.** Interactive `facet add`, `facet install`, and `facet remove` display one MCP-only approval screen containing every effective server, claimant facet, exact command, ordered arguments, environment assignments, or URL. Non-interactive and frozen operations require `--accept-mcp`; without it, they fail before mutation with the complete declaration list. Approval is machine-local, is committed only after the entire operation succeeds, and is never inferred from shared project files.

**Servers support durable aliases, omissions, and collision resolution.** Project manifest `0.2` adds `materialization.servers`, using the same Keep, Alias, and Omit workflow as assets while retaining a separate server namespace. Identical declarations at one effective name compose into one configuration; different declarations form a complete collision group without selecting a winner.

**Native configuration is reconciled transactionally.** Every adapter prepares its complete change read-only before prompting or mutation. Configuration is applied after asset writes, preserves unrelated settings and unowned entries, and is restored byte-for-byte if any later adapter or project-state commit fails. Existing untracked native entries require explicit takeover approval; untracked asset destinations retain a separate continue-or-cancel confirmation that `--accept-mcp` does not authorize.

**Receipt `0.4` records configuration ownership and approval without storing declaration secrets.** Earlier receipts retain asset ownership but confer no MCP ownership or approval. The lockfile remains at `0.3`; declarations continue to be integrity-protected through the embedded facet manifest.

**Adapter compatibility widens to the exact set `{0.1, 0.2}`.** API `0.1` adapters remain usable for projects without active MCP declarations. Active declarations require API `0.2` with MCP support, and failures identify every adapter that must be upgraded or every declaration that must be omitted.

**Breaking:** speculative version-string and `{ image }` server references are rejected instead of producing a skip warning. Republish affected facets with concrete declarations.
