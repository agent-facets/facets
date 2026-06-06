---
"agent-facets": minor
---

Add the `facet remove` command (aliased `rm`) — the inverse of `facet add`.

`facet remove <facet> [more facets...]` takes one or more facets back out of a project in a single command: it removes them from `facets.json`, deletes their assets from every connected adapter, and rewrites `facets.lock` without them.

- **Transactional** — removal reuses the same install pipeline as `facet add`, so any failure restores `facets.json` byte-for-byte and leaves the project unchanged.
- **All-or-nothing** — when removing multiple facets, if any name is not declared in `facets.json`, nothing is removed.
- **Strict** — removing a facet that is not declared fails with a clear error instead of silently succeeding. Every facet you don't name is left untouched.
- **`--verbose`** — emits detailed step output on stderr, matching `facet add`/`facet install`.
