---
"agent-facets": minor
"@agent-facets/engine": minor
---

**Breaking:** Unify on a single `.facet` directory naming convention.

User-home paths and environment variables drop the plural:

- `~/.facets/cache/` → `~/.facet/cache/`
- `~/.facets/adapters/` → `~/.facet/adapters/`
- `FACETS_CACHE_DIR` → `FACET_CACHE_DIR`
- `FACETS_ADAPTERS_DIR` → `FACET_ADAPTERS_DIR`

The project-local install lock moves from a directory entry to a single
top-level file:

- `<projectRoot>/.facets/.install.lock` → `<projectRoot>/.facet.lock`

This means `facet install` no longer creates a `.facet*` directory in
your project root — only a single `.facet.lock` file that lives next to
`facets.json`.

**No automatic migration.** Existing cached payloads and installed adapters
at `~/.facets/` are not migrated, copied, or detected. The new code looks at
`~/.facet/` only. Users with existing data may delete `~/.facets/` manually,
or move its contents to `~/.facet/` if they want to preserve the cache.
Users who had `FACETS_CACHE_DIR` or `FACETS_ADAPTERS_DIR` set in shell rc
files will silently fall back to defaults until they rename the variables.
