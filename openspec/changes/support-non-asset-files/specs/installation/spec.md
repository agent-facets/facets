## ADDED Requirements

### Requirement: Archive-only supplementary files are never materialized

Supplementary files outside skill directories SHALL remain available inside the verified facet archive but SHALL NOT be written into any selected adapter. They SHALL NOT receive an asset type, scope, independent lockfile asset entry, or per-file lockfile record. Their bytes SHALL remain protected by facet-level archive integrity.

#### Scenario: Root README is not installed

- **WHEN** a verified facet contains declared root `README.md`
- **THEN** installation SHALL NOT write that file into any adapter tree
- **AND** the lockfile SHALL NOT record `README.md` under an asset

#### Scenario: Extra agent-adjacent file is not installed

- **WHEN** a verified facet contains declared archive-only `agents/notes.md`
- **THEN** installation SHALL materialize no file for that supplementary entry

#### Scenario: Archive-only tampering still blocks installation

- **WHEN** an archive-only supplementary entry has been altered after build
- **THEN** facet-level integrity verification SHALL fail before any materialized file is written

### Requirement: Drift is detected and reported per locked file

The system SHALL compare every materialized file with its canonical per-file integrity record. Verbatim companion files SHALL be hashed from their installed bytes. When an adapter stores a primary asset in a transformed representation, its read result SHALL provide canonical logical content for comparison. Drift reports SHALL identify the exact locked path rather than only the owning facet or asset.

#### Scenario: Companion drift identifies exact path

- **WHEN** installed `skills/review/references/api.md` differs from its locked canonical bytes
- **THEN** the system SHALL report that exact path as drifted

#### Scenario: Transformed primary compares canonically

- **WHEN** an adapter stores metadata around a primary asset but returns its canonical logical content
- **THEN** drift comparison SHALL use the canonical content integrity rather than adapter-specific storage bytes

#### Scenario: Reinstall repairs one drifted file

- **WHEN** one companion in an otherwise unchanged skill bundle has drifted
- **THEN** reinstall SHALL restore that file from verified content
- **AND** the user-visible result SHALL identify its exact path

### Requirement: Unsupported archive versions fail with actionable guidance

Installation SHALL accept current `0.2` and valid legacy `0.1` archives during the compatibility window. Any other archive version SHALL return structured failure data containing the observed and supported versions before materialization. A malformed current archive SHALL NOT be reinterpreted as legacy. For a known newer archive format, the user-facing failure SHALL name the minimum release that supports it. For an unknown future format, the failure SHALL advise updating to the latest release without inventing a minimum version.

#### Scenario: Known newer format names its minimum supporting release

- **WHEN** an archive uses a format unsupported by this release but mapped to a known newer release
- **THEN** installation SHALL fail before materialization
- **AND** the message SHALL name the minimum supporting release
- **AND** project, lockfile, receipt, and adapter state SHALL remain unchanged

#### Scenario: Unknown future format advises updating to latest

- **WHEN** an archive uses a format for which no supporting release is known
- **THEN** installation SHALL fail before materialization
- **AND** the message SHALL advise updating to the latest release without naming a minimum
- **AND** project, lockfile, receipt, and adapter state SHALL remain unchanged

#### Scenario: Valid legacy archive remains installable

- **WHEN** a valid `0.1` archive is installed during the compatibility window
- **THEN** the system SHALL apply the legacy verification and materialization behavior

#### Scenario: Malformed current archive is not retried as legacy

- **WHEN** a `0.2` archive violates the current schema
- **THEN** installation SHALL fail under the current rules
- **AND** the system SHALL NOT retry it as `0.1`

## MODIFIED Requirements

### Requirement: Facet operations require compatible selected adapters before mutation

Before adding, removing, or installing facets, the system SHALL verify that every selected installed adapter declares an API supported by the current CLI. If a selected adapter is missing its declaration, has a malformed or unsupported declaration, conflicts with its recorded package declaration, or cannot be loaded as a valid adapter, the operation SHALL fail before invoking any adapter contract method or writing project or materialized state. The failure SHALL identify every incompatible selected adapter and provide the best available compatible-install command. The system SHALL NOT automatically upgrade or replace an incompatible adapter during a facet operation.

This adapter-compatibility preflight SHALL run before archive-version dispatch and before any per-file integrity reconciliation, so an adapter declaring the superseded positional API `0.0` SHALL cause a `0.1`-only CLI to fail on the adapter — with reinstall guidance — before the archive's `facetVersion` is examined. The adapter API axis and the archive-format axis SHALL be classified independently.

Facet removal SHALL remain independent of cached facet content and network access, but it SHALL still require compatible selected adapters because deleting materialized assets invokes each selected adapter's contract.

#### Scenario: Adding a facet with an incompatible selected adapter changes nothing

- **WHEN** a user adds a facet
- **AND** a selected installed adapter does not declare an API supported by the CLI
- **THEN** the operation SHALL fail before any facet is materialized
- **AND** no adapter contract method SHALL be invoked
- **AND** the project manifest, lockfile, install receipt, and materialized assets SHALL remain unchanged
- **AND** the error SHALL direct the user to install a compatible adapter

#### Scenario: Positional 0.0 adapter blocks a facet operation before archive dispatch

- **WHEN** a user adds or installs a facet whose archive uses `facetVersion: 0.2`
- **AND** a selected installed adapter declares the positional API `0.0`
- **AND** the CLI supports only the tagged-contract API `0.1`
- **THEN** the operation SHALL fail on the incompatible adapter before the archive version is dispatched
- **AND** no adapter contract method SHALL be invoked
- **AND** the project manifest, lockfile, install receipt, and materialized assets SHALL remain unchanged
- **AND** the error SHALL direct the user to reinstall a compatible adapter

#### Scenario: Installing with several incompatible adapters reports all of them

- **WHEN** a user installs the project's declared facets
- **AND** more than one selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** the operation SHALL fail before any materialization write
- **AND** the failure SHALL identify every incompatible selected adapter and every selected adapter that cannot be loaded
- **AND** each compatibility failure SHALL include its best available repair command

#### Scenario: Removing a facet does not bypass adapter compatibility

- **WHEN** a user removes a facet
- **AND** a selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** the operation SHALL fail before deleting any materialized asset
- **AND** the project manifest, lockfile, install receipt, and materialized assets SHALL remain unchanged

#### Scenario: Compatible selected adapters allow facet operations to proceed

- **WHEN** a user adds or installs a facet
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the operation SHALL proceed through the applicable fetch, integrity verification, materialization, and project-state update requirements

#### Scenario: Facet operation does not auto-upgrade an incompatible adapter

- **WHEN** a facet operation detects an incompatible selected adapter
- **THEN** the system SHALL NOT download or activate a replacement adapter automatically
- **AND** the failure SHALL direct the user to an explicit adapter install command

### Requirement: Lockfile declares a version

The lockfile SHALL declare `lockfileVersion`. Current lockfiles SHALL use numeric `0.2`. Version selection SHALL use exact equality rather than numeric ordering: numeric `1` SHALL identify only the preceding closed-alpha schema, and numeric `0.2` SHALL identify only the current schema. Missing or unsupported versions SHALL produce structured rejection data.

A normal install MAY migrate a verified legacy numeric-`1` lockfile to `0.2` only after the resolved artifacts satisfy every current integrity check. Frozen installation SHALL retain legacy behavior without rewriting a numeric-`1` lockfile. A current `0.2` archive SHALL require a `0.2` lockfile in frozen mode. Before a future stable lockfile v1 reuses numeric `1`, legacy-alpha support SHALL be removed and old-shape files SHALL receive actionable delete-and-regenerate guidance rather than shape-based reinterpretation.

#### Scenario: Missing lockfile version

- **WHEN** a lockfile omits `lockfileVersion`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Current lockfile version is accepted

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.2` and satisfies the current schema
- **THEN** the system SHALL accept it as current

#### Scenario: Legacy alpha version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** the system SHALL interpret it under the previous alpha schema only
- **AND** it SHALL NOT infer a schema from the remaining shape

#### Scenario: Unsupported lockfile version is rejected

- **WHEN** a lockfile declares an unsupported version
- **THEN** the system SHALL reject it with structured data identifying the observed and supported versions

#### Scenario: Normal install migrates verified legacy state

- **WHEN** a non-frozen install loads a valid legacy-alpha lockfile and verifies the resolved artifact
- **THEN** it MAY write an equivalent `0.2` lockfile after successful installation

#### Scenario: Frozen install does not migrate legacy state

- **WHEN** frozen installation uses a valid legacy-alpha lockfile and legacy artifact
- **THEN** it SHALL retain legacy behavior and SHALL NOT rewrite the lockfile

#### Scenario: Frozen current archive requires current lockfile

- **WHEN** frozen installation encounters a `0.2` archive with a legacy-alpha lockfile
- **THEN** it SHALL fail without rewriting any state

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every current facet entry SHALL include an `assets` array. Each member SHALL record `scope`, `type`, `name`, and a required `files` array sorted deterministically by canonical path. `scope` SHALL be `system`, `user`, or `project`; `type` SHALL be `skill`, `agent`, or `command`. Each file record SHALL contain canonical inner-archive `path` and `sha256:<hex>` `integrity` over canonical archive bytes. The lockfile SHALL contain no adapter-specific fields or adapter-encoded hashes.

A skill's file records SHALL include `skills/<name>/SKILL.md` and every declared companion. An agent or command SHALL contain exactly its conventional primary file record. Companions SHALL remain subordinate to their owning skill and SHALL NOT become independent assets or receive their own scopes. Archive-only supplementary files SHALL NOT appear in an asset's files.

#### Scenario: Valid multi-file skill entry

- **WHEN** a skill named `planning` owns `SKILL.md` and two companions
- **THEN** its lockfile asset entry SHALL contain three sorted canonical file records with integrity values

#### Scenario: Valid single-file asset entry

- **WHEN** an agent entry has `scope: "user"`, `type: "agent"`, and `name: "reviewer"`
- **THEN** its `files` array SHALL contain exactly `agents/reviewer.md` and its integrity

#### Scenario: Missing files array is rejected

- **WHEN** a `0.2` asset entry omits `files`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Companion is not an independent asset

- **WHEN** skill `review` owns companion `references/api.md`
- **THEN** the companion SHALL appear only in the skill's `files` array
- **AND** it SHALL NOT appear as another asset entry

#### Scenario: Archive-only path is excluded

- **WHEN** a facet archive contains declared root `README.md`
- **THEN** no lockfile asset's `files` array SHALL contain `README.md`

#### Scenario: Unknown asset scope

- **WHEN** an asset entry has `scope: "global"`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Unknown asset type

- **WHEN** an asset entry has `type: "hook"`
- **THEN** the system SHALL reject the lockfile

### Requirement: A machine-local record tracks what each project has materialized

The system SHALL maintain a machine-local receipt describing the asset and file ownership successfully materialized for each project. The receipt SHALL be separate from version-controlled state, identified by canonical project location, and sufficient for offline rollback and removal without cache or network access. Each canonical project location SHALL have its own receipt; two projects SHALL never share one, and concurrent operations in different projects SHALL NOT contend on the same receipt. The receipt SHALL survive lockfile changes made outside the system. Current receipts SHALL use schema version `0.2` and mirror each committed lockfile asset/file ownership set without storing adapter-encoded hashes. A project without a receipt SHALL bootstrap one from its current lockfile. A legacy receipt MAY be refined to primary-only ownership because legacy installation could not materialize companions.

The receipt, lockfile, and materialized state SHALL commit together: within one operation, handled failures SHALL roll back all three, and an interruption that prevents rollback SHALL be recoverable by re-running installation, whose per-file integrity reconciliation converges disk, lockfile, and receipt without deleting unowned files. Receipt-driven deletion SHALL pass each skill's validated owned companion path set into the adapter deletion request, so removal after a pulled lockfile drops an entry deletes exactly the recorded owned files without cache or network access. The receipt SHALL determine what is currently materialized when pulled version-control changes remove lockfile entries. In frozen-lockfile mode, receipt-driven cleanup SHALL begin only after the frozen consistency check passes. If that check rejects an orphaned lockfile entry, installation SHALL fail before cleanup changes any materialized state. Receipt data SHALL be treated as untrusted: project identity, record shape, and path containment within the selected adapter's storage SHALL be validated before deletion. Invalid or escaping records SHALL be reported and SHALL NOT cause deletion; files not recorded as owned SHALL never be deleted.

#### Scenario: Pulled change still cleans up a multi-file skill

- **WHEN** version-control changes remove a facet from the manifest and lockfile but the receipt records its skill primary and companions
- **THEN** install SHALL supply the validated recorded companion paths in the adapter deletion request
- **AND** delete every recorded owned file from each selected adapter
- **AND** no network or cache content SHALL be required

#### Scenario: Interrupted install converges on re-run

- **WHEN** an installation is interrupted after some skill-bundle writes but before lockfile and receipt commit
- **THEN** re-running installation SHALL compare locked per-file integrity against disk and complete or repair the bundle
- **AND** the re-run SHALL NOT delete any file not recorded as owned

#### Scenario: Removal needs neither cache nor network

- **WHEN** a facet is no longer wanted, its content is not cached, and its registry is unavailable
- **THEN** the system SHALL remove its recorded files using the receipt

#### Scenario: Project without a receipt bootstraps one

- **WHEN** a project has a lockfile but no receipt
- **THEN** the next operation SHALL create a project-specific receipt from current locked ownership

#### Scenario: Escaping receipt path is not deleted

- **WHEN** a receipt companion path resolves outside its selected adapter's storage through traversal, an absolute path, or a link
- **THEN** the system SHALL NOT delete that path
- **AND** it SHALL report the invalid record while continuing to process valid owned paths safely

#### Scenario: Mismatched project receipt is ignored

- **WHEN** a receipt's project identity differs from the active project
- **THEN** the system SHALL NOT delete anything based on that receipt
- **AND** it SHALL recreate ownership from the current lockfile

#### Scenario: Unowned file in a skill directory survives cleanup

- **WHEN** a skill directory contains a user file absent from the receipt's ownership records
- **THEN** skill removal SHALL leave that file unchanged

### Requirement: Integrity is verified before any asset is written

The system SHALL verify fetched or locally built facet content before writing any asset. For a current install, it SHALL require exact agreement between the lockfile's facet integrity and recomputed archive integrity; lockfile asset identities and verified materialization identities; each asset's complete locked path set and its verified owned-file set; and each per-file locked integrity, recomputed entry hash, and verified build-manifest hash. Any disagreement SHALL abort before materialization and return structured data identifying the facet, asset, canonical path, expected integrity, and actual integrity when available. Normal resolution SHALL write a replacement lock entry only after all checks succeed; frozen mode SHALL fail without rewriting.

#### Scenario: Registry content fails declared integrity

- **WHEN** fetched registry content differs from registry-declared integrity
- **THEN** installation SHALL abort before writing any asset or project state
- **AND** the failure SHALL identify the facet and expected and observed hashes

#### Scenario: Registry content fails self-declared integrity

- **WHEN** registry integrity matches but the archive does not reproduce its self-declared integrity
- **THEN** installation SHALL abort with structured archive-corruption data

#### Scenario: Cached content fails locked integrity

- **WHEN** cached content does not reproduce the lockfile's facet integrity
- **THEN** installation SHALL abort and identify the facet

#### Scenario: Git or local content fails computed integrity

- **WHEN** a built git or local artifact differs from its locked facet integrity
- **THEN** installation SHALL abort and identify the facet

#### Scenario: Companion integrity mismatch identifies exact path

- **WHEN** locked `skills/review/references/api.md` differs from the recomputed archive-entry hash
- **THEN** installation SHALL abort before any write
- **AND** the failure SHALL contain that path and expected and actual integrity values

#### Scenario: Locked file set mismatch is rejected

- **WHEN** a skill's locked `files` set has a missing or extra path relative to verified owned files
- **THEN** installation SHALL abort with structured data identifying the differing path

#### Scenario: Frozen mismatch does not rewrite

- **WHEN** any current per-file integrity check fails in frozen mode
- **THEN** manifest, lockfile, receipt, and adapter state SHALL remain unchanged

### Requirement: Removing a facet uninstalls it

When a user removes a facet from a project, the system SHALL drop the facet from the project manifest, delete the facet's materialized assets from every selected adapter, and update the lockfile and the receipt so neither records the facet — all in a single operation. A user SHALL NOT need to run a separate install step after removing. The asset set to delete SHALL be taken from the receipt, so removal SHALL require neither the cache nor the network. Skill deletion SHALL supply the validated owned companion path set in the adapter deletion request and SHALL remove the primary and every owned companion atomically while leaving unowned files untouched. Before deleting any materialized asset, the system SHALL verify that every selected installed adapter loads as a valid adapter and declares an API supported by the CLI. When a selected adapter has a missing, malformed, unsupported, or metadata-inconsistent API declaration, or cannot be loaded as a valid adapter, removal SHALL fail before deleting any materialized asset and SHALL leave the project manifest, lockfile, receipt, and materialized assets unchanged. An adapter declaring the superseded positional API `0.0` SHALL be unsupported by a CLI whose supported set is the tagged-contract API `0.1` and SHALL trigger this failure. This compatibility precondition SHALL require neither cache access nor network access; once the adapter incompatibility is repaired, removal SHALL remain able to use the receipt without either resource.

#### Scenario: Removing a declared facet uninstalls it

- **WHEN** a user removes a facet that is declared in the project manifest
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the system SHALL remove the facet's manifest entry, locked entry, receipt entry, and every recorded materialized file in one command

#### Scenario: Removing multi-file skill preserves unowned content

- **WHEN** a removed facet owns `skills/review/SKILL.md` and `skills/review/references/api.md` but not `skills/review/notes.txt`
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** deletion SHALL remove the primary and owned companion
- **AND** it SHALL preserve `notes.txt`

#### Scenario: Other facets are left intact

- **WHEN** one facet is removed from a project with several facets
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** every other facet's manifest, lockfile, receipt, and materialized files SHALL remain unchanged

#### Scenario: Removing the last facet leaves an empty project

- **WHEN** the user removes the only declared facet
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the manifest and lockfile SHALL remain valid and contain no facets

#### Scenario: Removal deletes recorded assets without cache or network

- **WHEN** a user removes a facet whose content is absent from the cache and whose registry is unreachable
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the system SHALL still delete that facet's recorded owned files using the receipt
- **AND** removal SHALL succeed without any cache read or network access

#### Scenario: An incompatible adapter blocks removal without weakening offline recovery

- **WHEN** a user removes a facet
- **AND** a selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** removal SHALL fail before deleting any materialized asset
- **AND** the project manifest, lockfile, receipt, and materialized assets SHALL remain unchanged
- **AND** the failure SHALL NOT require or result from cache access or network access
- **AND** after the adapter incompatibility is repaired, removal SHALL remain able to use the receipt without cache or network access
