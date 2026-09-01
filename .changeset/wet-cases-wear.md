---
"agent-facets": patch
---

Fix the crash when installing a facet from a git source for the first time.

Installing a git-sourced facet on a cold cache aborted with
`TypeError: Object.entries requires that input parameter not be null or
undefined` instead of installing anything. The clone succeeded and the build
succeeded; the run died on the step that commits the built content to the
cache.

The build pipeline emits the current `0.2` archive format, which records one
hash per archive entry under `files`. The git install path re-read that
output as the legacy `0.1` shape, whose map is named `assets` — a member the
current format does not have — and handed the resulting `undefined` to the
cache write, which audits every entry it is given.

The cache write now takes the integrity and the complete per-entry hash map
straight from the build result rather than re-deriving them by re-parsing the
build manifest, so this call site is no longer coupled to one archive-format
shape. Nothing about which files are audited or what is written changed: the
same entries are verified, and the cache sidecar records the full set,
including supplementary files that no asset owns.

Only fresh clones were affected — a first install, or one whose cache slot
was cold or evicted. Installs served by an audited cache hit, and facets from
the registry or a local path, never took this path.
