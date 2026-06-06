---
"agent-facets": patch
---

Make `facet install --frozen-lockfile` fail on orphaned lockfile entries.

A frozen install now reports a facet that is pinned in `facets.lock` but no longer declared in `facets.json` as drift (`orphaned`) and fails before touching the project. Previously the preflight only checked manifest entries, so an orphaned entry slipped through and the drift-removal pass pruned its assets while skipping the lockfile write — mutating adapter state and leaving a stale lockfile. The drift report's per-facet shape is now a discriminated union on its reason, so an `unsatisfied` entry always carries its locked version and an `orphaned` entry carries no manifest specifier.
