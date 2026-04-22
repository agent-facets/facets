---
"@agent-facets/core": patch
"@agent-facets/adapter": patch
---

Fix release pipeline: `prepack` no longer attempts to rewrite `workspace:*` references in `devDependencies`. Unblocks publishing when a devDep points at a workspace-only versionless package like `@agent-facets/common`. `npm pack` strips devDependencies from the tarball anyway, so there was nothing to rewrite in the first place.
