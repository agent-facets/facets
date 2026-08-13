---
"@agent-facets/adapter": minor
"@agent-facets/adapter-claude-code": minor
"@agent-facets/adapter-opencode": minor
"@agent-facets/adapter-codex": minor
---

**Adapter API `0.3`: adapters plan, the CLI writes.** The asset and MCP contracts are now strictly read-only. An adapter inspects, decides what should change, and returns exact per-file transitions — an absolute path, the state it observed that path in, and the bytes to commit. The CLI performs every write.

This buys guarantees no adapter could offer on its own, and now applies uniformly to assets, MCP documents, and the project's own manifest, lockfile, and receipt:

- **Concurrency.** The state an adapter reports is the write's precondition. A file something else edited between planning and writing is refused and reported, never clobbered.
- **Atomicity.** One logical operation's file changes commit together. A skill's primary, its companions, and its obsolete-companion removals all land or none do.
- **Exact restoration.** Both endpoints of every change are recorded, so a failure restores the precise prior bytes and permission bits — comments, formatting, and member order intact. Byte-exact rollback no longer depends on re-rendering an asset from parsed data, so YAML front matter and TOML survive a rollback exactly as the author wrote them.
- **No phantom drift.** A file already holding the bytes a plan would write contributes no change, so a re-install touches no modification time.

**Breaking: `installAsset`, `readAsset`, and `deleteAsset` are replaced by `assets: false | { planInstall, planRemoval }`.** `supportsInstall` is gone — an adapter states its asset capability the same way it states MCP support, so "claims support" and "implements support" can no longer disagree.

**Breaking: the MCP capability is `mcpServers: false | { plan }`.** `apply` is gone, as is the opaque plan type and the `conflict/document-changed` reason. Concurrency is detected once, by the CLI, for every file it writes. A document an adapter inspects but does not change is no longer journaled or restored.

**`plan` returns `documentPaths`: every file it was computed from, including when it changes none of them.** The list grants nothing — a file named there and not changed is never written, journaled, or restored. It exists so the CLI can establish, before it asks for approval, that no two selected adapters manage the same configuration file; two that do now fail with both named, because neither ordering leaves both plans applicable. Every plan is also recomputed immediately before its own commit, including one that concluded nothing needed writing, so a document edited while the approval screen was open is reported rather than quietly reported as configured.

**Breaking: every asset request carries `projectRoot`, at every scope.** Adapters must not derive the project from the process working directory: a caller installing into a tree it is not running inside would otherwise materialize assets somewhere else.

**Breaking: the mutating SDK helpers are replaced by planners.** `installSkillBundle` / `readSkillBundle` / `deleteSkillBundle` become `planSkillBundleInstall` / `planSkillBundleRemoval`; `installSingleFileAsset` / … become `planSingleFileInstall` / `planSingleFileRemoval`; `applyMcpTextPlan` is gone and `prepareMcpTextPlan` now returns exact file mutations. `ADAPTER_API_VERSION_ASSETS_ONLY` and `AssetOnlyAdapter` are removed.

A skill whose primary file is already gone now has its owned companions removed rather than retained: each companion has an exact observed state of its own, so removing it is reversible. The `obsolete-bundle-retained` warning is gone with the condition that produced it.
