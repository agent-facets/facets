---
"@agent-facets/protocol": minor
"agent-facets": minor
---

Honor edited versions in `facets.json` and add `facet install --frozen-lockfile`.

`facet install` now re-resolves a lockfile entry whose version no longer satisfies the manifest (e.g. a hand-edited bump), and fails if the requested version doesn't exist instead of silently keeping the old one. The new `--frozen-lockfile` flag treats the lockfile as authoritative and fails on any manifest/lockfile drift, for reproducible CI installs.
