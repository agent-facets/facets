---
'agent-facets': minor
'@agent-facets/core': minor
---

`facet add` and `facet install` land for closed-alpha dogfood.

- **`facet add <source>`** — parses github/git+/file: specifiers, resolves (git clone with `GIT_TERMINAL_PROMPT=0` + SHA support, or local path with project-tree containment), reads the source's `facet.json`, and atomically edits `facets.json` (comment-preserving via `comment-json`).
- **`facet install`** — runs the build pipeline against each source tree (closed-alpha "repo root as facet source" per design), computes a drift-proof diff vs. the prior lockfile, and materializes assets through every adapter with `supportsInstall: true`. Adapter-agnostic `facets.lock` with an `assets: [{scope, type, name}]` list per facet — the same asset set applies to every selected adapter.
- **Best-effort rollback** — in-memory journal replays inverse ops on adapter error or SIGINT; rollback failures report a clear "partial state; re-run to reconcile" message.
- **`--verbose`** — `[verbose] <step>` lines to stderr for partner bug reports.
- **`--dry-run`** — prints the would-be plan and exits 0 without touching disk.
- **Shared install picker** — Ink multi-select shown in both `facet adapter install` (no-arg) and `facet install` zero-adapter paths; codex row is rendered dimmed + non-selectable until it flips `supportsInstall`.
- **Atomic parallel-install lock** — `.facets/.install.lock` via `O_CREAT|O_EXCL` with stale-pid recovery.
- **Stub commands** (`info`, `list`, `publish`, `remove`, `upgrade`) are hidden from `facet --help` but stay invocable so typos still get "did you mean…" suggestions.
- **Core**: new adapter-agnostic `LockfileSchema`, `FacetsJsonSchema`, and pure manifest mutations (`parseFacetsJson`, `serializeFacetsJson`, `upsertFacetInManifest`, `removeFacetFromManifest`). Comments in hand-edited `facets.json` survive round-trips.
- **Public docs** rewritten for closed-alpha scope: `README.md` quickstart points partners at `docs/alpha/partner-onboarding.md`; `docs/cli.mdx` callout supersedes the old registry claim; install spec + openspec spec lead with closed-alpha behavior, with open-beta extensions appended.

This is Changeset #2 of the two-changeset install-pipeline ship — release and publish this set *after* the adapter set so partners never pull a (new CLI × old adapter) combination. Then run the pre-ship smoke test per `docs/alpha/partner-onboarding.md`.
