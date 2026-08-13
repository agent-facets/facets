---
"agent-facets": minor
---

<!--
DEFERRED CHANGESET — not in `.changeset/`, and deliberately so.

Move this file to `.changeset/` only after `@agent-facets/adapter-claude-code`,
`@agent-facets/adapter-opencode`, and `@agent-facets/adapter-codex` all report
`facetAdapterApiVersion: 0.3` on npm. See "Adapter API compatibility rollout"
in `scripts/release/README.md`.

Leaving it in `.changeset/` would put the CLI and the adapters in one Version
PR, whose tags publish in parallel — the exact race the adapter-first order
exists to prevent. A note asking a human not to merge it is not a mechanism;
its absence from `.changeset/` is.
-->

**Every file an operation changes is now restorable to its exact prior state.** Assets, native MCP documents, and the project's own `facets.json`, `facets.lock`, and receipt all commit through one filesystem transaction that records each change as the exact state before and the exact state after. Adapters no longer write anything: they return exact per-file transitions, and the CLI commits them.

**A file the run only inspected is never journaled**, so a concurrent edit to it survives a rollback untouched. **A file this run wrote and something else then changed is preserved and reported by path** rather than overwritten, and rollback continues past it so one contested file cannot strand the rest. **Restoration is byte-exact**, including permission bits, so YAML front matter and TOML formatting come back as authored instead of being re-rendered from parsed data. **A file already holding the bytes a plan would write contributes no change**, so a re-install touches no modification time.

**Preconditions are checked immediately before each write.** A file something else moved between planning and writing is refused and reported, never clobbered. Rollback removes only directories the run created that are still empty and still the directories it made; a pre-existing directory always survives, and any remaining file prevents removal.

**A failed operation reports what it left on disk, by path.** The report distinguishes a file deliberately left alone from one whose restoration genuinely failed, and gives each its own remedy. Facets never prompts to force-overwrite a contested file, interactively or otherwise.

**Breaking: the supported adapter API is now exactly `{0.3}`.** Every already-installed adapter — first-party included — reports `unsupported` until reinstalled, and `facet adapter list` prints the exact command per entry. Under `0.1` and `0.2` an adapter performed its own writes and owned its own rollback, which cannot deliver the guarantees above. An adapter declaring no MCP support still cannot configure servers, and that answer no longer changes with a newer release, so the failure names the adapters whose declarations must be omitted or which must be deselected.

**Removed:** the `obsolete-bundle-retained` outcome. A skill bundle whose primary is already gone now has its owned companions removed, because each carries its own exact observed state and is individually restorable.
