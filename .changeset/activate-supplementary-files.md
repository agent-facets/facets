---
'agent-facets': minor
---

**BREAKING (pre-1.0 minor):** activate supplementary-file support, archive and lockfile format `0.2`, and adapter API `0.1`.

Every `facet build` now emits `facetVersion: 0.2` with a complete per-entry hash map. Facets can explicitly declare opaque supplementary files: skill companions install and remove atomically with their owning skill, while root and other archive-only files remain integrity-protected without being materialized. Valid legacy `0.1` archives remain installable during the compatibility window.

Current lockfiles and machine-local receipts use format `0.2` with canonical per-file integrity and ownership records, enabling exact-path drift reporting, repair, rollback, and offline removal without deleting unowned files.

`facet create` writes and declares an editable `README.md` by default, with `--no-readme` as the headless opt-out. `facet edit` manages both `README.md` and the extensionless `README` and reconciles supplementary declarations transactionally.

New manifests require single-segment Agent Skills names, and skills and commands cannot share a name. Existing published `0.1` archives retain legacy naming behavior, but affected source manifests must be renamed before rebuilding as `0.2`.

This CLI supports only the tagged adapter API `0.1`. Positional `0.0` adapters fail closed before contract calls or project mutation with reinstall guidance. Rebuild custom adapters against the current `@agent-facets/adapter` SDK and reinstall incompatible adapters before continuing.
