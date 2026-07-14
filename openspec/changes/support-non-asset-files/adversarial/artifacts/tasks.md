> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## 1. Protocol: Manifest Schema, Naming Grammar & Namespaces — Research

- [ ] 1.1 Explore: the facet manifest schema (`packages/protocol/src/schemas/facet.ts`): current skill/agent/command descriptor shapes, name validation, `parseAssetNameSegment`, and where multi-segment names are parsed today
- [ ] 1.2 Explore: existing manifest validation and collision detection (`packages/protocol/src/build/validate-facets.ts`, `detect-collisions.ts`): how duplicate-name failures are structured and rendered
- [ ] 1.3 Explore: how validated manifest data flows into loaders (`packages/protocol/src/loaders/facet.ts`, `resolvePromptsFromMap`) so schema changes don't break conventional-path inference
- [ ] 1.4 Propose: the schema changes: top-level `files: string[]`, `SkillDescriptor.files?: string[]`, single-segment Agent Skills name grammar (1–64 lowercase ASCII/digit/hyphen, no leading/trailing/consecutive hyphens), skill/command shared-namespace disjointness, agents separate, and the structured error shapes for each new failure class

## 2. Protocol: Manifest Schema, Naming Grammar & Namespaces — Implementation

- [ ] 2.1 Implement: the two `files` declaration sites in the facet manifest schema (exact paths only, no globs), with schema docs linking the Agent Skills `name` convention and stating the normative ASCII interpretation
- [ ] 2.2 Implement: the current-format single-segment asset-name grammar as the canonical parser; keep multi-segment parsing isolated to legacy `0.1` verification only
- [ ] 2.3 Implement: skill/command shared-namespace collision validation (structured failure identifying both declarations, e.g. `skills.review` and `commands.review`); agents remain a separate namespace
- [ ] 2.4 Implement: schema-level tests: valid/invalid asset names, namespace collisions, agent name sharing, `files` shape acceptance, glob rejection
- [ ] 2.5 Verify: protocol package tests, types, and lint pass for the schema/naming changes

## 3. Protocol: Path Grammar & Shared Archive Plan — Research

- [ ] 3.1 Explore: `collectArchiveEntries` and the build-side membership logic (`packages/protocol/src/build/content-hash.ts`, `validate-content.ts`): how conventional asset paths are derived and hashed today
- [ ] 3.2 Explore: the Step 6b outer-exclusivity allowlist in `packages/protocol/src/integrity/validate-archive.ts`: how the verify-side membership set is constructed and where it would consume a shared derivation
- [ ] 3.3 Propose: the D3 archive-plan operation: one pure function that validates both declaration sites under the D7 grammar and returns a tagged plan (`manifest` / `primary-asset` / `skill-companion` with owning skill / `archive-only`), plus the full D7 validation rules (canonical segments, no NUL/backslash/drive/URL prefixes, regular-files-only with resolved-identity checks, root `facet.json` reservation, conventional-path collisions, site disjointness, Unicode/case-fold/prefix collision classes) as distinct structured `ValidationError`s

## 4. Protocol: Path Grammar & Shared Archive Plan — Implementation

- [ ] 4.1 Implement: the D7 path-grammar validators as pure protocol functions with one structured error per failure class
- [ ] 4.2 Implement: the shared archive-plan derivation returning tagged entries; classification comes only from the embedded `facet.json`
- [ ] 4.3 Implement: build-side consumption: `collectArchiveEntries` (and per-entry hashing) derives membership from the archive plan; `ArchiveEntry.content` widens to `string | Uint8Array`; supplementary bytes are read verbatim (no front-matter, normalization, or empty-content rules; binary allowed)
- [ ] 4.4 Implement: source-input validation ordering: all declared inputs (primary + supplementary) validate before any `dist/` cleanup; missing declared files produce structured errors while previous output is preserved
- [ ] 4.5 Implement: the D7 per-failure-class test matrix: traversal, absolute/drive paths, backslashes, NUL, empty/`.` segments, Unicode/case aliases, prefix collisions, symlinks, hard links, duplicates, root-`facet.json` collision, conventional-primary-path collision, missing declarations, undeclared entries, empty and binary supplementary files
- [ ] 4.6 Verify: protocol tests, types, and lint pass for the plan/grammar changes

## 5. Protocol: Build Manifest 0.2, Verification & Tagged Results — Research

- [ ] 5.1 Explore: the build-manifest schema and version handling (`packages/protocol/src/schemas/build.ts` or equivalent): where `facetVersion` is declared, how the `assets` map is validated, and where `FACET_ARCHIVE_VERSION` lives
- [ ] 5.2 Explore: `parseFacetArchive` and the full verification pipeline (outer container parse, decompressor injection, integrity checks, per-entry hash checks) and its structured result types
- [ ] 5.3 Explore: existing archive fixtures and how deterministic archives are produced in tests, to plan immutable `0.1` and `0.2` fixture sets
- [ ] 5.4 Propose: the versioned schema design: exact-equality `facetVersion` dispatch at parse time, `0.2` schema with a single all-entry `files` hash map (no `assets` key) and `0.1` retaining `assets` (no `files` key), structured `UNSUPPORTED_FACET_VERSION` failure carrying observed + supported versions, no cross-version fallback, and the tagged successful parse result (primary assets as text, skill companions grouped by owning skill, archive-only bytes)

## 6. Protocol: Build Manifest 0.2, Verification & Tagged Results — Implementation

- [ ] 6.1 Implement: the versioned build-manifest schemas with strict exact-equality dispatch and the structured unsupported-version failure
- [ ] 6.2 Implement: `0.2` build-manifest production: flat manifest with `facetVersion: 0.2`, `archive`, `integrity`, and a complete `files` hash map covering `facet.json`, every primary asset, and every supplementary file — emitted unconditionally for asset-only facets too
- [ ] 6.3 Implement: raw tar-header validation before any path-keyed map: duplicate paths, non-regular entries (symlinks, hard links, directories, devices), unsafe/non-canonical paths, and portable-alias collisions each return structured rejections
- [ ] 6.4 Implement: `0.2` verification: derive the expected set from the embedded manifest via the archive plan (never the build manifest), require exact three-way set equality (observed entries, expected plan, `files` keys), then byte-verify every entry hash; keep legacy `0.1` verification byte-for-byte unchanged
- [ ] 6.5 Implement: the tagged parsed-archive result: primary assets exposed as text (empty-content/front-matter rules apply only to them), companions grouped by owning skill as bytes, archive-only entries as bytes; current naming/namespace rules validated for `0.2`, legacy rules retained for `0.1`
- [ ] 6.6 Implement: immutable fixture sets for both archive versions plus tamper cases: undeclared entry, declared-but-missing entry, build-manifest-only entry that must not legitimize membership, per-entry hash mismatch, duplicate/alias/non-regular tar entries, unsupported `0.3` version
- [ ] 6.7 Verify: protocol tests, types, and lint pass for build-manifest and verification changes

## 7. Protocol: Lockfile 0.2 Schema & Per-File Integrity — Research

- [ ] 7.1 Explore: the lockfile schema (`packages/protocol/src/schemas/lockfile.ts`) and `LOCKFILE_VERSION`: current version constant, asset-entry shape, and how version dispatch works today
- [ ] 7.2 Propose: the lockfile `0.2` schema: exact-equality dispatch (legacy numeric `1` vs numeric `0.2`), required per-asset `files` arrays sorted by canonical path with `{ path, integrity }` records, skill/agent/command file-set rules, archive-only exclusion, and the structured mismatch result types install will consume

## 8. Protocol: Lockfile 0.2 Schema & Per-File Integrity — Implementation

- [ ] 8.1 Implement: the lockfile `0.2` schema and exact-equality version dispatch; keep `FACET_ARCHIVE_VERSION` and `LOCKFILE_VERSION` as separate constants both currently `0.2`
- [ ] 8.2 Implement: the per-file integrity record types and the structured per-file mismatch failure shape (facet, asset, canonical path, expected/actual integrity)
- [ ] 8.3 Implement: schema tests: valid multi-file skill entries, exactly-one-file agent/command entries, archive-only exclusion, missing `files` rejection, legacy numeric `1` selected exactly with no shape-sniffing, unsupported versions rejected with structured data
- [ ] 8.4 Verify: protocol tests, types, and lint pass for lockfile changes

## 9. Engine Consumer Bridge: Loaders, Lockfile Migration & Receipt 0.2 — Research

- [ ] 9.1 Explore: engine loaders and cache (`packages/engine/src/loaders/facet.ts`, `cache/`): where parsed archives are consumed and what changes when the parse result becomes tagged
- [ ] 9.2 Explore: lockfile I/O and the frozen-mode guard (`packages/engine/src/install/lockfile-io.ts`, `lockfile-guard.ts`): load/validate/write paths and where migration hooks in
- [ ] 9.3 Explore: the receipt module (`packages/engine/src/install/receipt.ts`): current asset-tuple schema, bootstrap, validation-before-deletion, and project-identity checks
- [ ] 9.4 Propose: the consumer bridge: loaders/cache consume the tagged result; normal installs migrate verified legacy numeric-`1` lockfiles to `0.2` while frozen mode retains legacy behavior without rewriting; receipt schema `0.2` mirrors committed lockfile asset/file ownership (legacy receipts refined to primary-only sets); unsupported-version and per-file mismatch failures flow through as structured results

## 10. Engine Consumer Bridge: Loaders, Lockfile Migration & Receipt 0.2 — Implementation

- [ ] 10.1 Implement: loader/cache consumption of the tagged parse result for both archive versions; supplementary bytes stay opaque end to end
- [ ] 10.2 Implement: lockfile migration: normal install rewrites a verified legacy lockfile to `0.2` only after all current checks pass; frozen legacy stays legacy; frozen `0.2` archive with a legacy lockfile fails without rewriting
- [ ] 10.3 Implement: receipt schema `0.2` with per-asset owned-file sets, bootstrap-from-lockfile, legacy refinement to primary-only ownership, and untrusted-input validation (project identity, containment, record shape) before any deletion
- [ ] 10.4 Implement: tests: legacy migration, frozen non-rewriting, receipt bootstrap/refinement, escaping-receipt-path never deleted while valid records still process
- [ ] 10.5 Verify: engine tests, types, and lint pass for the consumer bridge

## 11. Adapter SDK: Tagged Payloads & Atomic Skill Bundles — Research

- [ ] 11.1 Explore: the adapter SDK contract (`packages/adapter/src/types.ts`, `define-adapter.ts`): `installAsset`/`readAsset`/`deleteAsset` signatures and how results are shaped today
- [ ] 11.2 Explore: the SDK filesystem helpers (`asset-fs.ts`): write/delete/dir-pruning machinery that must grow staging, commit/rollback, and owned-path removal
- [ ] 11.3 Explore: the claude-code adapter's path resolution and storage layout to plan its migration to skill-directory bundles
- [ ] 11.4 Propose: the tagged request/result unions keyed by asset type (skill carries primary text + canonical companion-path→bytes map, empty map legal; agent/command carry one text value and structurally no companions; no supplementary variant), the atomic stage/commit/rollback bundle lifecycle with owned-path removal and empty-directory pruning, companion-root containment checks, and the canonical-content `readAsset` contract

## 12. Adapter SDK: Tagged Payloads & Atomic Skill Bundles — Implementation

- [ ] 12.1 Implement: the tagged install/read/delete request and result unions in the SDK types (breaking change, next minor release)
- [ ] 12.2 Implement: the SDK filesystem helpers: companion containment within the resolved skill root, staged all-or-nothing bundle replacement (removing previously-owned companions absent from the new bundle), atomic ownership-based deletion, empty-directory pruning limited to owned removals
- [ ] 12.3 Implement: `readAsset` returning canonical logical primary content (adapter encoding stripped) plus the complete owned companion byte map
- [ ] 12.4 Implement: the claude-code adapter migration onto the new helpers, including skill-directory path resolution for companions
- [ ] 12.5 Implement: injected-failure integration tests at every write/delete/commit boundary proving no partial bundle survives install or delete failure, plus unowned-file preservation and escaping-companion-path rejection tests
- [ ] 12.6 Verify: adapter SDK and claude-code tests, types, and lint pass

## 13. Engine Producer: Build 0.2, Materialization & Install Reconciliation — Research

- [ ] 13.1 Explore: the build pipeline (`packages/engine/src/build/pipeline.ts`, `write-output.ts`): stage ordering, dist cleanup timing, and progress display hooks
- [ ] 13.2 Explore: materialization and the install orchestrator (`packages/engine/src/install/materialize.ts`, `run-install.ts`, `journal.ts`): per-asset install flow, skip-if-identical logic, journaling for rollback, and the lockfile/receipt commit sequence
- [ ] 13.3 Explore: facet removal and drift-check flows to map where per-file integrity comparison and receipt-driven deletion change
- [ ] 13.4 Propose: the producer wiring: pipeline consumes the archive plan and emits `0.2` unconditionally; engine passes companions only inside skill-variant payloads and withholds archive-only files entirely (materialization boundary in engine, not adapters); install performs the four-way pre-materialization agreement checks (facet integrity, asset identities, complete path sets, per-file hashes vs. recomputed + build-manifest values); receipt+lockfile+materialization commit as one transaction with rollback restoring all three; per-companion skip/journal; per-locked-file drift with canonical-content comparison for transformed primaries

## 14. Engine Producer: Build 0.2, Materialization & Install Reconciliation — Implementation

- [ ] 14.1 Implement: build-pipeline emission of `0.2` archives via the shared archive plan, with validation-before-cleanup ordering preserved end to end
- [ ] 14.2 Implement: build output display: emitted `facetVersion`, complete inner-archive entry listing including supplementary files, archive-assembly progress stage, and integrity in the persistent summary
- [ ] 14.3 Implement: the four-way pre-materialization integrity reconciliation with structured per-path mismatch failures; frozen mode fails without rewriting; normal mode writes replacement lock entries only after all checks pass
- [ ] 14.4 Implement: lock-entry derivation from the verified archive plan's materialized subset with recomputed (never blindly copied) per-file hashes, sorted deterministically
- [ ] 14.5 Implement: materialization through skill-variant bundle payloads with per-companion skip-if-identical and journal-backed rollback; archive-only files never reach `materialize`
- [ ] 14.6 Implement: the single-transaction commit of receipt, lockfile, and materialized state, and receipt-driven removal (including pulled-lockfile cleanup) that deletes only validated owned paths
- [ ] 14.7 Implement: per-locked-file drift detection: verbatim hashing for companions, canonical-content comparison via `readAsset` for transformed primaries, reports naming the exact locked path, and single-file repair on reinstall
- [ ] 14.8 Implement: engine end-to-end tests: full build→verify→install→drift→remove cycle for a facet with companions and archive-only files, legacy `0.1` archive install compatibility, and abort-before-write on every mismatch class
- [ ] 14.9 Verify: engine tests, types, and lint pass for the producer changes

## 15. CLI: README Authoring, Edit Reconciliation & Error Rendering — Research

- [ ] 15.1 Explore: the `facet create` wizard (`packages/cli/src/tui/`, `packages/engine/src/scaffold/`): step/card structure, confirmation preview, and atomic apply
- [ ] 15.2 Explore: the `facet edit` workbench (`packages/engine/src/edit/`: reconcile, scanner, manifest-writer, operations): discovery phases, queued-operation model, and Apply transaction
- [ ] 15.3 Explore: CLI error rendering (`packages/cli/src/util/errors.ts` and install/build command surfaces) to place unsupported-version guidance and new validation failure rendering
- [ ] 15.4 Propose: the CLI changes: create wizard README step (default-on, seeded from name/description, editable, disableable, listed in confirmation, atomic write + declaration, never regenerated after identity edits); edit README panel for exact `README.md` and `README` with state-dependent actions (Edit/Remove, Adopt/Edit-and-Adopt, Scaffold/Remove-Declaration, Create defaulting to `README.md`), both paths independent, excluded from generic reconciliation; generic scanner additions (undeclared skill-directory companions, common root files like `LICENSE`, scaffold-or-remove for vanished declarations); and the single CLI compatibility table mapping known archive formats to minimum supporting releases with latest-release advice for unknown formats

## 16. CLI: README Authoring, Edit Reconciliation & Error Rendering — Implementation

- [ ] 16.1 Implement: the create-wizard README step with seeded editable content, default-on/optional behavior, confirmation listing, and atomic `README.md` write plus top-level `files` declaration
- [ ] 16.2 Implement: the edit README panel with all four state-dependent action sets for both exact conventional paths, transactional through the existing Apply confirmation
- [ ] 16.3 Implement: generic edit reconciliation: undeclared skill-companion adoption, common root-file adoption, scaffold-or-remove for missing declared supplementary files, README excluded from the generic phase
- [ ] 16.4 Implement: CLI rendering of new structured failures (path grammar, collisions, namespace, per-file integrity, unsupported version) including the compatibility-table upgrade guidance
- [ ] 16.5 Implement: CLI e2e tests: create-with-README, README panel flows, companion adoption, build/install error rendering for the new failure classes
- [ ] 16.6 Verify: CLI tests, types, and lint pass

## 17. Documentation & Release Notes

- [ ] 17.1 Implement: updates to `docs/specification/archive.mdx`, `build.mdx`, `manifest.mdx`, and `integrity.mdx`: membership rules and single `files` hash map, plan derivation and validation-before-cleanup, both `files` declaration fields with the minimum-producer-version warning and linked Agent Skills naming convention, all-entry and per-locked-file integrity coverage
- [ ] 17.2 Implement: updates to `docs/specification/lockfile.mdx`, `commit.mdx`, and `install.mdx`: lockfile `0.2` with per-materialized-file integrity and legacy-alpha-1 migration/stable-v1 regeneration boundary, receipt ownership and transactional reconciliation, materialization boundary and atomic skill bundles with mismatch diagnostics
- [ ] 17.3 Implement: updates to `docs/guides/create-your-first-facet.mdx`, `docs/guides/install-facets.mdx`, and root `README.md`: replace asset-only phrasing, document the README workflow and supplementary files
- [ ] 17.4 Implement: the protocol release-policy update encoding the pre-1.0 minor-release rule for breaking changes, and draft release notes describing previously-conforming behavior that is no longer accepted (multi-segment asset names, skill/command name sharing, `0.1` producer output)
- [ ] 17.5 Verify: docs build/lint and cross-check every doc claim against the implemented behavior

## 18. Final Verification

- [ ] 18.1 Verify: the full repo suite (`bun check`) passes across all packages, including the D7 failure-class matrix, both-version fixtures, and injected-failure adapter tests
- [ ] 18.2 Verify: implementation coverage against the change's delta specs scenario-by-scenario and confirm consumer-first sequencing constraints (cafe gate, bridge-before-producer) are documented in the release plan
