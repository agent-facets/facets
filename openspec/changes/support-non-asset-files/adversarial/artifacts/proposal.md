## Why

Facet authors cannot currently include documentation, licenses, development notes, or companion skill resources in a built facet because the artifact contract rejects every file that is not a declared skill, agent, command, or manifest. Facets need a safe way to carry these supporting files without falsely treating them as independently installable assets.

## What Changes

- The facet manifest SHALL be able to declare supplementary files, including conventional files such as `README.md`, `LICENSE`, `DEVELOPMENT.md`, and nested files belonging to a skill.
- A build SHALL include every declared supplementary file in the deterministic facet archive and SHALL integrity-protect it with the same per-file and whole-archive guarantees applied to asset files. Missing, undeclared, duplicate, or unsafe file paths SHALL fail validation rather than creating an ambiguous artifact.
- Supplementary files SHALL remain distinct from assets: they SHALL NOT acquire an asset type, adapter metadata, an independent install scope, or a lockfile asset tuple.
- When a skill is installed, declared files contained by that skill's directory SHOULD be materialized with the skill through the adapter. Supplementary files associated with command and agent paths, and files elsewhere in the facet, SHALL remain archive content and SHALL NOT be materialized.
- `README.md` SHALL be documented as a conventional supplementary file, while the manifest retains one general file-declaration mechanism rather than a second README-specific source of truth.
- **BREAKING**: Artifacts containing supplementary files extend the archive entry set beyond the current format's asset-only exclusivity rule. The protocol/archive format SHALL use an explicit compatibility boundary so older consumers do not misinterpret these artifacts; existing asset-only facets SHALL remain valid.
- Documentation covering manifests, builds, archives, integrity, authoring, and installation SHALL be updated to distinguish archived files from installable assets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `authoring__facets`: Authors can declare, validate, and build supplementary files in addition to installable assets.
- `protocol__schemas`: Published facet and build-manifest schemas represent the complete tracked file set without classifying supplementary files as assets.
- `protocol__content-hashing`: Deterministic archives and per-file hash records cover all declared content, not only asset prompt files.
- `protocol__integrity`: Archive verification reconciles and verifies every declared supplementary file while preserving path-safety guarantees.
- `installation`: Installation materializes companion files inside installed skill directories but retains other supplementary files only as verified archive content.
- `adapter__assets`: The skill installation contract can carry a skill's declared companion-file tree without expanding command or agent installation into directory installation.

## Non-goals

- This change SHALL NOT add a `facet info` command or render README content in the CLI; retaining README content enables that separate future capability.
- This change SHALL NOT make arbitrary supplementary files directly installable or add new adapter-independent destination paths.
- This change SHALL NOT give commands or agents companion-directory installation semantics.
- This change SHALL NOT preserve executable permissions, symlinks, or other filesystem metadata for supplementary files.
- This change SHALL NOT automatically package untracked source-tree files; archive membership remains explicit and reviewable.

## Impact

The published protocol and reference implementation will change across manifest/build schemas, archive assembly and parsing, content hashing, verification, build validation, installation planning/materialization, and the adapter SDK's skill-install input. Implementations will need compatibility tests for legacy asset-only artifacts and the new archive format, plus security tests for traversal, collisions, undeclared entries, and tampering of non-asset files.

This proposal was informed by `docs/specification/manifest.mdx`, `docs/specification/build.mdx`, `docs/specification/archive.mdx`, `docs/specification/integrity.mdx`, `docs/guides/create-your-first-facet.mdx`, `docs/guides/install-facets.mdx`, and the root `README.md`. Those pages currently describe facets and integrity in asset-only terms and SHOULD be updated with the new tracked-file and materialization boundaries.
