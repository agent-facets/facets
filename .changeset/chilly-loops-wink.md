---
"agent-facets": patch
---

Make `facet install --frozen-lockfile` reproduce the lockfile exactly.

Frozen mode now guarantees the installed project matches the lockfile bit-for-bit — no extra facets, no missing facets, no source changes, and no content changes:

- **Source drift** — a git or local facet whose manifest source string (URL, ref, or path) no longer matches the locked source now fails the preflight (`source-changed`) before any clone or build, instead of silently building from the unlocked origin.
- **Local content drift** — a local facet is now verified against its locked integrity in frozen mode, exactly like git. Editing a local source's content fails the install rather than rebuilding and overwriting the entry.
- **Cache correctness (frozen and non-frozen)** — a git facet whose manifest URL changed bypasses the content-addressed cache entirely (the cache key carries no source provenance), so a changed URL re-resolves from the new source instead of reusing cached bytes from the old one.
