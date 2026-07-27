## ADDED Requirements

### Requirement: Namespace collisions are evaluated across the complete desired set before any write

Before writing or deleting any materialized asset, project manifest, lockfile, or receipt, the system SHALL evaluate every authored asset contributed by the complete post-operation facet set. This evaluation SHALL run for add, install, update, repair, removal, and frozen reproduction. It SHALL report every collision group in one pass and SHALL NOT choose a winner, infer precedence from declaration or resolution order, or overwrite one facet's asset with another.

Two assets SHALL collide when they have the same scope, materialization namespace, and portable effective name. Skills and commands SHALL share one namespace; agents SHALL occupy another. Assets in different scopes SHALL NOT collide. Skill companions SHALL follow their skill and SHALL NOT be independent claimants. Existing within-facet validation and MCP server behavior SHALL remain unchanged.

#### Scenario: Added facet collides with an installed facet

- **WHEN** an added facet and an already-declared facet each contribute project-scoped skill `review`
- **THEN** the system SHALL report both claimants before any write
- **AND** neither asset SHALL overwrite the other

#### Scenario: Update introduces a collision

- **WHEN** a newly resolved facet version introduces a name that collides with another desired asset
- **THEN** the system SHALL detect it before materialization
- **AND** project and adapter state SHALL remain unchanged until resolution

#### Scenario: Skill and command collide

- **WHEN** a skill and a command in the same scope have effective name `deploy`
- **THEN** the system SHALL place them in one collision group

#### Scenario: Agent and skill coexist

- **WHEN** an agent and a skill in the same scope have effective name `review`
- **THEN** the system SHALL NOT report a collision between them

#### Scenario: All groups are reported

- **WHEN** the desired set contains three collision groups
- **THEN** one evaluation SHALL report all three groups and every claimant

#### Scenario: Declaration order does not select a winner

- **WHEN** an unresolved collision is present
- **THEN** reordering facet declarations SHALL NOT change the failure or materialize either claimant

### Requirement: Every colliding asset receives one Keep, Alias, or Omit resolution

Each colliding asset SHALL receive exactly one outcome: Keep its authored name, Alias it to a valid effective name, or Omit it from materialization. The accepted draft MUST be collision-free across the complete desired set. The system SHALL allow aliasing all claimants, omitting all claimants, transferring a name from an omitted asset, and exchanging effective names when the final set is unique. An alias MUST satisfy the current single-segment asset-name grammar and SHALL be rejected rather than normalized when invalid.

Resolutions SHALL be consumer project intent. They SHALL NOT rename the facet, mutate `facet.json`, alter published archive bytes, or be declared by publishers.

#### Scenario: One claimant is aliased

- **WHEN** two skills claim `review` and one is aliased to `vendor-review`
- **THEN** the effective set SHALL contain both `review` and `vendor-review`

#### Scenario: Every claimant is aliased

- **WHEN** every claimant is assigned a distinct alias
- **THEN** the system SHALL accept the collision-free result

#### Scenario: Every claimant is omitted

- **WHEN** every claimant is omitted
- **THEN** the system SHALL accept the empty result for that collision group

#### Scenario: Duplicate alias remains a collision

- **WHEN** two assets resolve to the same alias in one namespace and scope
- **THEN** the system SHALL report both as still colliding

#### Scenario: Invalid alias is rejected

- **WHEN** an alias contains uppercase letters, a slash, or another disallowed form
- **THEN** the system SHALL reject it with the asset-name validation reason

### Requirement: Aliases and omissions affect materialization without changing authored integrity

An alias SHALL change only the effective name supplied for materialization. Authored name, content, canonical archive paths, and integrity values SHALL remain unchanged, and occurrences of the authored name inside content SHALL NOT be rewritten. An omission SHALL prevent the asset and all owned companions from being written, while the complete authored asset remains verified and recorded in the lockfile. Omitted assets SHALL be absent from machine-local materialized ownership.

One project-level disposition SHALL apply to every selected adapter. Per-adapter aliases, omissions, and asset sets SHALL NOT be accepted.

#### Scenario: Aliased content remains authored

- **WHEN** skill `review` is materialized as `vendor-review`
- **THEN** every adapter SHALL receive the verified authored content under `vendor-review`
- **AND** canonical integrity paths SHALL remain under `skills/review/`

#### Scenario: Omitted skill writes nothing

- **WHEN** a skill with companions is omitted
- **THEN** no selected adapter SHALL receive its primary or companion files
- **AND** its authored files SHALL remain verified and locked

#### Scenario: All adapters receive one effective set

- **WHEN** multiple adapters are selected
- **THEN** each SHALL receive the same aliases and omissions

### Requirement: Recorded materialization intent is durable and stale intent is handled transactionally

Materialization overrides in the project manifest SHALL remain durable after the collision that motivated them disappears. Teammates, automation, repair, update, and reproduction SHALL use recorded intent without prompting when it produces a collision-free set. A change to an override SHALL re-materialize the affected asset without requiring version resolution when the locked version still satisfies the source specifier.

When an override names an asset absent from the resolved facet version, a non-frozen operation SHALL report the facet, asset type, and authored name and SHALL prune the override only in a successful commit. A failed operation SHALL preserve it. Frozen installation SHALL treat it as drift and write nothing.

#### Scenario: Teammate reproduces aliases without prompting

- **WHEN** a teammate installs committed manifest and lockfile state whose dispositions are collision-free
- **THEN** the same effective set SHALL be materialized without prompting

#### Scenario: Alias remains after another facet is removed

- **WHEN** the facet that originally caused a collision is removed
- **THEN** the surviving alias SHALL remain effective

#### Scenario: Missing authored asset is pruned only on success

- **WHEN** a resolved facet no longer contains an asset named by an override
- **AND** a normal install succeeds
- **THEN** the system SHALL report and remove that override in the successful commit

#### Scenario: Failed install retains stale override

- **WHEN** an operation that discovered a stale override fails
- **THEN** the project manifest SHALL retain the override

### Requirement: Interactive resolution completes before mutation and unresolved collisions fail safely

When interactive resolution is available, the system SHALL expose the complete authored contribution set and current overrides for revision until the final effective set is collision-free or the user cancels. Temporary draft collisions SHALL be allowed before confirmation. The final choices SHALL be validated again before mutation and SHALL reach disk only through the operation's successful commit.

When resolution is unavailable, cancelled, or forbidden by frozen mode, the system SHALL return structured data for every group and claimant and SHALL leave manifest, lockfile, receipt, and materialized assets unchanged. Adapter compatibility and facet integrity failures SHALL occur before collision choices are requested.

#### Scenario: User resolves every collision

- **WHEN** an interactive user confirms a collision-free set of choices
- **THEN** materialization SHALL proceed with that effective set
- **AND** intent and resolved state SHALL commit together on success

#### Scenario: Temporary draft conflict is retained

- **WHEN** a user proposes an alias that collides with an earlier draft choice
- **THEN** the draft SHALL retain and report the linked conflict for further revision
- **AND** materialization SHALL NOT begin

#### Scenario: Cancellation changes nothing

- **WHEN** the user cancels collision resolution
- **THEN** manifest, lockfile, receipt, and materialized assets SHALL remain unchanged

#### Scenario: Non-interactive unresolved collision changes nothing

- **WHEN** an unresolved collision is encountered without an interactive resolver
- **THEN** the operation SHALL fail with every group and claimant identified
- **AND** no adapter write or deletion SHALL occur

#### Scenario: Adapter incompatibility precedes resolution

- **WHEN** a selected adapter is incompatible and the desired set would collide
- **THEN** the operation SHALL fail for adapter incompatibility without requesting collision choices

### Requirement: Materialized ownership is reconciled against the complete effective set

The system SHALL plan deletion and replacement from the complete previous ownership and complete desired effective set. A materialized identity SHALL be deleted only when no desired asset still claims its adapter identity. Cross-facet ownership transfer SHALL replace content without leaving the retained identity deleted. Duplicate historical claims SHALL be aggregated, each obsolete identity SHALL be deleted at most once per adapter, and all recorded owned companions absent from the new owner SHALL be removed while unowned files remain untouched.

Changing an alias SHALL delete the old effective identity and write the new one transactionally. Changing to omitted SHALL delete prior ownership; removing omission SHALL materialize the asset. A disposition-only change SHALL be reported as updated, while disk-only drift SHALL remain repaired.

#### Scenario: Ownership transfer retains the identity

- **WHEN** one facet is removed while another desired asset takes its effective name
- **THEN** the identity SHALL contain the new owner's content after success
- **AND** it SHALL NOT be left deleted

#### Scenario: Alias change moves owned files

- **WHEN** an alias changes from `vendor-review` to `partner-review`
- **THEN** the old owned files SHALL be deleted and the new effective asset SHALL be written in one operation

#### Scenario: Historical duplicate claims do not delete a survivor

- **WHEN** a receipt has duplicate historical claims for one adapter identity and the desired set retains that identity
- **THEN** the identity SHALL NOT be deleted
- **AND** companions absent from the retained ownership SHALL be removed

### Requirement: Project-manifest format migration is transactional

A successful non-frozen add, install, update, or removal SHALL write current `manifestVersion: 0.1`, including when reading a valid legacy unversioned compact manifest. A failed operation SHALL leave the prior bytes unchanged. Frozen installation SHALL accept valid legacy unversioned input when consistency checks pass and SHALL NOT migrate or rewrite it. Expanded entries in an unversioned manifest and unsupported explicit versions SHALL fail before mutation.

#### Scenario: Successful normal install migrates unversioned input

- **WHEN** a normal install succeeds from a valid unversioned compact manifest
- **THEN** the committed manifest SHALL declare `manifestVersion: 0.1`
- **AND** every previously declared facet entry SHALL be preserved with unchanged meaning

#### Scenario: Failed operation does not migrate

- **WHEN** an operation fails while reading a valid unversioned compact manifest
- **THEN** the manifest SHALL remain byte-for-byte unversioned

#### Scenario: Frozen operation retains legacy manifest

- **WHEN** frozen installation succeeds with a valid unversioned compact manifest
- **THEN** it SHALL NOT rewrite the manifest

## MODIFIED Requirements

### Requirement: Lockfile declares a version

The lockfile SHALL declare `lockfileVersion`. Current lockfiles SHALL use numeric `0.3`. Version selection SHALL use exact equality rather than numeric ordering: numeric `1` SHALL identify only the preceding closed-alpha schema, numeric `0.2` SHALL identify only the preceding schema, and numeric `0.3` SHALL identify only the current schema. Shape inference and cross-version fallback SHALL NOT occur. Missing or unsupported versions SHALL produce structured rejection data.

Every successful non-frozen install SHALL write `0.3`, including when no materialization overrides exist. A verified numeric-`1` or `0.2` lockfile SHALL be migrated only after every resolved artifact satisfies every current integrity check, with each earlier asset refined to authored materialization. Removing all overrides SHALL NOT downgrade the lockfile. Frozen installation SHALL retain legacy behavior without rewriting a numeric-`1` or `0.2` lockfile and SHALL fail if its schema cannot represent the project manifest's materialization intent. A current `0.2` archive SHALL require a `0.2`-or-current lockfile in frozen mode. Before a future stable lockfile v1 reuses numeric `1`, legacy-alpha support SHALL be removed and old-shape files SHALL receive actionable delete-and-regenerate guidance rather than shape-based reinterpretation.

#### Scenario: Missing lockfile version

- **WHEN** a lockfile omits `lockfileVersion`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Current lockfile version is accepted

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.3` and satisfies the current schema
- **THEN** the system SHALL accept it as current

#### Scenario: Previous version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.2`
- **THEN** the system SHALL interpret it only under the preceding schema
- **AND** each asset SHALL be understood as authored materialization

#### Scenario: Legacy alpha version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** the system SHALL interpret it under the earliest alpha schema only
- **AND** it SHALL NOT infer a schema from the remaining shape

#### Scenario: Unsupported lockfile version is rejected

- **WHEN** a lockfile declares an unsupported version
- **THEN** the system SHALL reject it with structured observed and supported versions

#### Scenario: Normal install migrates verified earlier state

- **WHEN** a non-frozen install loads a valid `1` or `0.2` lockfile and verifies every resolved artifact
- **THEN** it SHALL write equivalent `0.3` state after successful installation

#### Scenario: Resolution-free project still migrates

- **WHEN** a non-frozen install succeeds without any override
- **THEN** the committed lockfile SHALL declare `0.3`

#### Scenario: Frozen install does not migrate

- **WHEN** frozen installation uses a supported earlier lockfile whose consistency check passes
- **THEN** it SHALL NOT rewrite the lockfile

#### Scenario: Frozen install fails when resolutions require the current format

- **WHEN** frozen installation uses a numeric-`1` or `0.2` lockfile
- **AND** the project manifest records materialization intent that format cannot represent
- **THEN** the operation SHALL fail without rewriting any state

#### Scenario: Frozen current archive requires a compatible lockfile

- **WHEN** frozen installation encounters a current `0.2` archive with a numeric-`1` lockfile
- **THEN** it SHALL fail without rewriting any state

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every current facet entry SHALL include an `assets` array. Each member SHALL record authored `scope`, `type`, and `name`, a required materialization disposition, and a required `files` array sorted deterministically by canonical authored path. `scope` SHALL be `system`, `user`, or `project`; `type` SHALL be `skill`, `agent`, or `command`. Each file record SHALL contain canonical inner-archive `path` and `sha256:<hex>` `integrity` over canonical archive bytes. The lockfile SHALL contain no adapter-specific fields, hashes, or dispositions.

The disposition SHALL state authored, aliased with a valid effective name, or omitted. Omitted assets SHALL remain listed with every authored file record. A skill's file records SHALL include `skills/<name>/SKILL.md` and every declared companion. An agent or command SHALL contain exactly its conventional primary file record. Skill companions SHALL remain subordinate to their owning skill, follow its disposition, and SHALL NOT become independent assets or receive their own scopes. Archive-only supplementary files SHALL NOT appear in an asset's files.

#### Scenario: Valid multi-file skill entry

- **WHEN** a skill owns `SKILL.md` and two companions
- **THEN** its entry SHALL contain three sorted authored file records and a disposition

#### Scenario: Valid single-file asset entry

- **WHEN** an agent entry records scope, type, and authored name `reviewer`
- **THEN** its files SHALL contain exactly `agents/reviewer.md` and its integrity

#### Scenario: Missing files array is rejected

- **WHEN** a `0.3` asset entry omits `files`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Missing disposition is rejected

- **WHEN** a `0.3` asset entry omits materialization
- **THEN** the system SHALL reject the lockfile

#### Scenario: Aliased asset keeps authored files

- **WHEN** skill `review` is aliased to `vendor-review`
- **THEN** its name and paths SHALL remain authored as `review`
- **AND** its disposition SHALL record the alias

#### Scenario: Omitted asset remains listed

- **WHEN** command `deploy` is omitted
- **THEN** its entry SHALL retain `commands/deploy.md` and its integrity

#### Scenario: Companion is not an independent asset

- **WHEN** skill `review` owns companion `references/api.md`
- **THEN** the companion SHALL appear only in the skill's files
- **AND** it SHALL NOT appear as another asset entry

#### Scenario: Archive-only path is excluded

- **WHEN** an archive contains root `README.md`
- **THEN** no asset's files SHALL contain it

#### Scenario: Unknown asset scope

- **WHEN** an asset scope is `global`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Unknown asset type

- **WHEN** an asset type is `hook`
- **THEN** the system SHALL reject the lockfile

### Requirement: A machine-local record tracks what each project has materialized

The system SHALL maintain a machine-local receipt describing the asset and file ownership successfully materialized for each project. The receipt SHALL be separate from version-controlled state, identified by canonical project location, and sufficient for offline rollback and removal without cache or network access. Each canonical project location SHALL have its own receipt; two projects SHALL never share one, and concurrent operations in different projects SHALL NOT contend on the same receipt. The receipt SHALL survive lockfile changes made outside the system. Current receipts SHALL use schema version `0.3` and record only assets actually materialized, with authored identity, authored owned-file paths, and the authored-or-aliased materialization disposition needed to address the effective adapter identity, without storing adapter-encoded hashes. Omitted assets SHALL NOT appear. A project without a receipt SHALL bootstrap one from the non-omitted assets in its current lockfile. Receipt `1` and `0.2` assets SHALL refine losslessly to authored materialization. A legacy receipt that predates companion ownership MAY be refined to primary-only ownership because legacy installation could not materialize companions.

The receipt, lockfile, and materialized state SHALL commit together: within one operation, handled failures SHALL roll back all three, and an interruption that prevents rollback SHALL be recoverable by re-running installation, whose per-file integrity reconciliation converges disk, lockfile, and receipt without deleting unowned files. Receipt-driven deletion SHALL aggregate duplicate historical claims by effective adapter identity, delete each obsolete identity at most once, and pass each skill's validated authored companion ownership into the adapter deletion request so removal after a pulled lockfile drops an entry deletes exactly the recorded owned files without cache or network access. The receipt SHALL determine what is currently materialized when pulled version-control changes remove lockfile entries. In frozen-lockfile mode, receipt-driven cleanup SHALL begin only after the frozen consistency check passes. If that check rejects an orphaned lockfile entry, installation SHALL fail before cleanup changes any materialized state. Receipt data SHALL be treated as untrusted: project identity, record shape, and path containment within the selected adapter's storage SHALL be validated before deletion. Invalid or escaping records SHALL be reported and SHALL NOT cause deletion; files not recorded as owned SHALL never be deleted.

#### Scenario: Pulled change cleans up a multi-file skill

- **WHEN** pulled state removes a facet but the receipt records its effective skill and companions
- **THEN** install SHALL supply the validated recorded companion paths in the adapter deletion request
- **AND** it SHALL delete every recorded owned file from each selected adapter
- **AND** no network or cache content SHALL be required

#### Scenario: Interrupted install converges on re-run

- **WHEN** installation is interrupted after some skill-bundle writes but before lockfile and receipt commit
- **THEN** re-running SHALL compare locked per-file integrity against disk and complete or repair the bundle
- **AND** the re-run SHALL NOT delete any file not recorded as owned

#### Scenario: Removal needs neither cache nor network

- **WHEN** an unwanted facet is uncached and its registry unavailable
- **THEN** the system SHALL remove recorded files using the receipt

#### Scenario: Project without a receipt bootstraps one

- **WHEN** a project has a lockfile but no receipt
- **THEN** the next operation SHALL create a project-specific receipt from non-omitted current locked ownership

#### Scenario: Omitted asset is excluded from receipt

- **WHEN** a lockfile asset is omitted
- **THEN** receipt bootstrap SHALL NOT record it as materialized

#### Scenario: Earlier receipts refine directly to current state

- **WHEN** the system loads receipt version `1` or `0.2`
- **THEN** it SHALL refine each asset to authored materialization in the in-memory current `0.3` receipt shape
- **AND** version `1` SHALL refine to primary-only ownership while `0.2` SHALL retain its complete owned-path set
- **AND** the next successful receipt write SHALL emit `0.3`, never an intermediate writer format

#### Scenario: Escaping receipt path is not deleted

- **WHEN** a receipt companion path resolves outside its selected adapter's storage through traversal, an absolute path, or a link
- **THEN** the system SHALL NOT delete that path
- **AND** it SHALL report the invalid record while continuing to process valid owned paths safely

#### Scenario: Mismatched project receipt is ignored

- **WHEN** receipt project identity differs from the active project
- **THEN** the system SHALL NOT delete anything based on that receipt
- **AND** it SHALL recreate ownership from the non-omitted assets in the current lockfile

#### Scenario: Unowned file survives cleanup

- **WHEN** a skill directory contains a file absent from receipt ownership
- **THEN** skill removal SHALL leave it unchanged

### Requirement: Integrity is verified before any asset is written

The system SHALL verify fetched or locally built facet content before writing any asset. For a current install, it SHALL require exact agreement between the lockfile's facet integrity and recomputed archive integrity; lockfile authored asset identities and verified authored identities; each asset's complete locked canonical authored path set and its verified owned-file set; and each per-file locked integrity, recomputed entry hash, and verified build-manifest hash. Materialization aliases and omissions SHALL NOT alter or bypass any comparison. Any disagreement SHALL abort before materialization and return structured data identifying the facet, asset, canonical authored path, expected integrity, and actual integrity when available. Normal resolution SHALL write a replacement lock entry only after all checks succeed; frozen mode SHALL fail without rewriting.

#### Scenario: Registry content fails declared integrity

- **WHEN** fetched content differs from registry-declared integrity
- **THEN** installation SHALL abort before writing asset or project state
- **AND** the failure SHALL identify the facet and expected and observed hashes

#### Scenario: Registry content fails self-declared integrity

- **WHEN** registry integrity matches but the archive does not reproduce its self-declared integrity
- **THEN** installation SHALL abort with structured corruption data

#### Scenario: Cached content fails locked integrity

- **WHEN** cached content does not reproduce the lockfile's facet integrity
- **THEN** installation SHALL abort and identify the facet

#### Scenario: Git or local content fails computed integrity

- **WHEN** a built git or local artifact differs from its locked facet integrity
- **THEN** installation SHALL abort and identify the facet

#### Scenario: Aliasing does not change verification identity

- **WHEN** authored skill `review` is aliased to `vendor-review`
- **THEN** verification SHALL still compare authored `skills/review/` paths and hashes

#### Scenario: Companion integrity mismatch identifies exact path

- **WHEN** locked `skills/review/references/api.md` differs from the recomputed archive-entry hash
- **THEN** installation SHALL abort before any write
- **AND** the failure SHALL contain that authored path and expected and actual integrity values

#### Scenario: Locked file-set mismatch is rejected

- **WHEN** a skill's locked `files` set has a missing or extra path relative to verified owned files
- **THEN** installation SHALL abort with structured data identifying the differing path

#### Scenario: Frozen mismatch does not rewrite

- **WHEN** current per-file verification fails in frozen mode
- **THEN** manifest, lockfile, receipt, and adapter state SHALL remain unchanged

### Requirement: Frozen-lockfile install treats the lockfile as authoritative

The system SHALL provide a frozen-lockfile mode for install in which the manifest and lockfile are treated as authoritative and reproduced exactly: no extra facets, no missing facets, no source changes, no content changes, and no materialization-intent changes. In this mode the system SHALL NOT perform version resolution, prompt for collision choices, migrate or write the manifest, or write the lockfile. Content download for a locked exact version absent from the cache SHALL remain permitted, because downloading already-locked bytes is reproduction, not drift. Because adding or removing a facet changes the locked set, the system SHALL reject a frozen-lockfile operation that carries any explicit add or removal before inspecting the lockfile.

Before cleanup or materialization, the system SHALL verify that the manifest uses a supported form and that the lockfile fully and consistently covers its sources and materialization intent. The system SHALL fail without modifying the project if any of the following is true: the operation carries an explicit add or removal; no lockfile exists; the lockfile cannot be read or does not satisfy its selected published schema; the manifest declares an unsupported explicit version; the manifest declares a facet that has no lockfile entry; a lockfile entry's recorded version does not satisfy its manifest specifier; manifest overrides differ from locked dispositions, name an absent locked asset, or leave an unresolved effective-name collision; the lockfile pins a facet the manifest no longer declares; or a git or local facet's manifest source string no longer matches its recorded provenance. Valid legacy unversioned manifests and supported earlier lockfiles MAY be reproduced without rewriting when their authored materialization agrees.

When the lockfile fully covers the manifest, the system SHALL install exactly the versions, integrity hashes, and effective materialized assets recorded in the lockfile, downloading any whose content is not cached. It SHALL verify that every facet—including cached content and local sources, which a non-frozen install would rebuild from disk—reproduces its recorded integrity and SHALL fail if any content does not match. Because frozen mode never creates a lockfile entry, it SHALL NOT require integrity confirmation against the registry; its only permitted network activity is downloading already-locked content.

Frozen mode constrains the locked set, not the machine's materialized state: assets that the receipt shows as materialized but that the lockfile-covered manifest no longer wants SHALL still be removed, and the receipt SHALL be updated to match, while the lockfile and manifest SHALL never be written. Receipt-driven cleanup SHALL begin only after every frozen consistency check passes.

#### Scenario: Frozen install proceeds when locked state covers intent

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** manifest sources and materialization intent exactly match supported locked state
- **THEN** the system SHALL reproduce exact versions, integrity, and effective assets without resolution or prompt
- **AND** it SHALL NOT write the manifest or lockfile

#### Scenario: Frozen mode downloads absent locked content

- **WHEN** a locked exact version's content is absent from the cache
- **THEN** the system SHALL download and verify that exact content
- **AND** it SHALL NOT treat the download as drift

#### Scenario: Frozen mode verifies cached content

- **WHEN** cached content differs from locked integrity
- **THEN** the system SHALL fail with an integrity error before materialization
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen verification is independent of cache warmth

- **WHEN** two frozen installs reproduce the same locked facet with warm and cold caches respectively
- **THEN** both SHALL derive and reconcile the same complete verified authored plan
- **AND** both SHALL retain the same authored companion bytes for Apply

#### Scenario: Frozen reproduction preserves companions

- **WHEN** a frozen install reproduces a skill whose primary and companions already match verified content
- **THEN** it SHALL treat the complete bundle as unchanged
- **AND** absence of a separately inherited companion map SHALL NOT be interpreted as an intentionally empty bundle or cause any companion deletion

#### Scenario: Frozen mode cleans receipt-only orphan

- **WHEN** manifest and lockfile both dropped a facet still present in the receipt
- **THEN** frozen consistency SHALL pass and receipt-driven cleanup SHALL remove its effective ownership
- **AND** the receipt SHALL be updated so it no longer lists the facet
- **AND** the manifest and lockfile SHALL remain unchanged

#### Scenario: Frozen mode rejects explicit delta

- **WHEN** frozen installation carries an add or removal
- **THEN** it SHALL fail before inspecting the lockfile or resolving any facet
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects missing lockfile

- **WHEN** no lockfile exists
- **THEN** frozen installation SHALL fail with an error stating the lockfile is missing
- **AND** it SHALL NOT create or modify the lockfile

#### Scenario: Frozen mode rejects an unsupported manifest version

- **WHEN** the manifest declares an unsupported explicit `manifestVersion`
- **THEN** frozen installation SHALL fail with the observed and supported versions
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects uncovered facet

- **WHEN** a manifest facet has no lockfile entry
- **THEN** frozen installation SHALL fail identifying that facet
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects version drift

- **WHEN** a locked version does not satisfy its manifest source
- **THEN** frozen installation SHALL fail identifying the facet, manifest specifier, and locked version
- **AND** it SHALL NOT perform version resolution
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects materialization drift

- **WHEN** manifest overrides disagree with locked dispositions or leave a collision
- **THEN** frozen installation SHALL fail identifying every affected asset
- **AND** it SHALL NOT prompt or write state

#### Scenario: Frozen mode rejects stale override

- **WHEN** an override names an asset absent from locked content
- **THEN** frozen installation SHALL fail identifying the facet, type, and authored name
- **AND** it SHALL NOT remove the override or write any state

#### Scenario: Frozen mode rejects orphaned lockfile entry

- **WHEN** the lockfile pins a facet absent from the manifest
- **THEN** frozen installation SHALL fail identifying the orphaned facet and its locked version
- **AND** it SHALL NOT prune the orphaned facet's assets
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects changed git or local source

- **WHEN** manifest source differs from locked git or local provenance
- **THEN** frozen installation SHALL fail identifying the facet, manifest source, and locked source
- **AND** it SHALL NOT clone, resolve, or build from the changed source
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects local content drift

- **WHEN** local content no longer reproduces locked integrity
- **THEN** frozen installation SHALL fail with an integrity error rather than rebuilding and overwriting the entry
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

### Requirement: Removing a facet uninstalls it

When a user removes a facet from a project, the system SHALL drop the facet from the project manifest, reconcile its effective materialized ownership across every selected adapter, and update the lockfile and receipt so neither records the facet—all in a single operation. A user SHALL NOT need to run a separate install step after removing. The ownership to reconcile SHALL be taken from the receipt, so removal SHALL require neither cache nor network access. The system SHALL delete a recorded effective adapter identity only when no desired asset retains it, SHALL delete each obsolete identity once, and SHALL aggregate historical duplicate claims so a surviving desired asset is never deleted. Skill deletion SHALL supply the validated authored companion ownership in the adapter deletion request and SHALL remove the primary and every obsolete owned companion atomically while leaving unowned files untouched.

Before deleting any materialized asset, the system SHALL verify that every selected installed adapter loads as a valid adapter and declares an API supported by the CLI. When a selected adapter has a missing, malformed, unsupported, or metadata-inconsistent API declaration, or cannot be loaded as a valid adapter, removal SHALL fail before deleting any materialized asset and SHALL leave the project manifest, lockfile, receipt, and materialized assets unchanged. An adapter declaring the superseded positional API `0.0` SHALL be unsupported by a CLI whose supported set is the tagged-contract API `0.1` and SHALL trigger this failure. This compatibility precondition SHALL require neither cache access nor network access; once the adapter incompatibility is repaired, removal SHALL remain able to use the receipt without either resource.

#### Scenario: Removing a declared facet uninstalls it

- **WHEN** a user removes a facet declared in the project manifest
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** its manifest entry, lockfile entry, receipt entry, and obsolete effective ownership SHALL be removed in one command

#### Scenario: Removing multi-file skill preserves unowned content

- **WHEN** a removed facet owns `skills/review/SKILL.md` and `skills/review/references/api.md` but not `skills/review/notes.txt`
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** deletion SHALL remove the primary and obsolete owned companion
- **AND** it SHALL preserve `notes.txt`

#### Scenario: Other facets are left intact

- **WHEN** one facet is removed from a project with several facets
- **AND** no effective adapter identity transfers to another desired owner
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** every other facet's manifest, lockfile, receipt, and materialized files SHALL remain unchanged

#### Scenario: Other facet retaining an identity is not deleted

- **WHEN** another desired facet owns the same effective adapter identity after removal
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** that identity SHALL remain and contain the desired owner's content

#### Scenario: Removing the last facet leaves an empty project

- **WHEN** the only declared facet is removed
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** manifest and lockfile SHALL remain valid and contain no facets

#### Scenario: Removal works offline

- **WHEN** removed facet content is uncached and its registry unreachable
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** receipt ownership SHALL allow removal without any cache read or network access

#### Scenario: Incompatible adapter blocks removal

- **WHEN** a selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** removal SHALL fail before deleting materialized assets
- **AND** the project manifest, lockfile, receipt, and materialized assets SHALL remain unchanged
- **AND** the failure SHALL NOT require or result from cache access or network access
- **AND** after the adapter incompatibility is repaired, removal SHALL remain able to use the receipt without cache or network access
