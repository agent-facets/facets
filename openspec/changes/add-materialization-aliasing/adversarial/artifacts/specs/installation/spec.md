## ADDED Requirements

### Requirement: Cross-facet asset collisions are detected before any materialization write

Before writing any materialized asset, the system SHALL evaluate the complete desired asset set across every facet the project declares and SHALL detect every group of assets whose effective materialized identities collide. The evaluation SHALL run on every path that materializes assets: adding a facet, installing, updating a facet, repairing drift, and frozen installation. Skills and commands SHALL be evaluated in one shared namespace; agents SHALL be evaluated in a separate namespace. When an unresolved collision is detected, the system SHALL NOT write any materialized asset, manifest change, lockfile change, or receipt change for the operation.

#### Scenario: Two facets declare the same skill name

- **WHEN** a user adds a facet declaring skill `review` to a project whose installed facets already contribute a skill named `review`
- **THEN** the system SHALL detect a collision between the two assets before any file is written
- **AND** the system SHALL identify both contributing facets and both colliding assets

#### Scenario: A skill and a command from different facets collide

- **WHEN** the desired asset set contains a skill named `deploy` from one facet and a command named `deploy` from another facet
- **THEN** the system SHALL detect a collision, because skills and commands share one namespace

#### Scenario: An agent and a skill with the same name do not collide

- **WHEN** the desired asset set contains an agent named `review` from one facet and a skill named `review` from another facet
- **THEN** the system SHALL NOT report a collision, because agents occupy a separate namespace

#### Scenario: A facet update introduces a new collision

- **WHEN** an installed facet's newly resolved version declares an asset whose name collides with an asset from another installed facet
- **AND** no recorded resolution covers the new collision
- **THEN** the update SHALL stop before any materialization write
- **AND** the system SHALL surface the new collision for resolution

#### Scenario: Collision within a single facet is unchanged

- **WHEN** a single facet's own manifest declares two assets with the same name in one namespace
- **THEN** the existing single-facet manifest validation SHALL reject it as it does today
- **AND** cross-facet collision handling SHALL NOT alter that behavior

### Requirement: Every colliding asset receives exactly one explicit resolution

For every detected collision group, each asset in the group SHALL receive exactly one resolution: preserve its authored name, materialize under an alias, or be omitted from materialization. The system SHALL NOT choose a winner silently, SHALL NOT infer precedence from install order or declaration order, and SHALL NOT overwrite one facet's asset with another's. A resolution set MAY alias multiple assets in a group and MAY omit every asset in a group, but the resulting effective materialized set MUST be collision-free.

#### Scenario: Aliasing one asset resolves a two-asset group

- **WHEN** two facets contribute skill `review` and the user assigns one of them the alias `review-acme`
- **AND** the other keeps its authored name
- **THEN** the resolution SHALL be accepted
- **AND** the effective materialized set SHALL contain `review` and `review-acme`

#### Scenario: Omitting every asset in a group is valid

- **WHEN** the user omits both colliding assets in a group
- **THEN** the resolution SHALL be accepted
- **AND** neither asset SHALL be materialized

#### Scenario: A resolution that still collides is rejected

- **WHEN** a proposed resolution assigns two assets in the shared skill/command namespace the same effective name — whether by aliasing both to one name, or by aliasing one onto another asset's preserved authored name
- **THEN** the system SHALL reject the resolution
- **AND** the system SHALL identify the assets whose effective names still collide

#### Scenario: The system never resolves a collision implicitly

- **WHEN** a collision group has no recorded resolution and no user input is available
- **THEN** the system SHALL NOT materialize any asset in the group under any precedence rule
- **AND** the operation SHALL fail rather than pick a winner

### Requirement: Interactive operations collect collision resolutions from the user

When an add or install runs in an interactive environment and detects a collision group with no recorded resolution, the system SHALL identify the colliding facets and assets and collect the user's resolution for each asset before proceeding. If the user cancels, the system SHALL leave the project manifest, lockfile, receipt, and on-disk adapter state unchanged.

#### Scenario: Interactive add prompts for a resolution

- **WHEN** a user interactively adds a facet that introduces an unresolved collision
- **THEN** the system SHALL present the collision group naming each contributing facet and asset
- **AND** the system SHALL collect one resolution per asset before any materialization write

#### Scenario: Cancelling resolution leaves the project unchanged

- **WHEN** a user cancels interactive collision resolution
- **THEN** the project manifest, lockfile, receipt, and adapter state SHALL be unchanged
- **AND** the operation SHALL exit without installing the facet

### Requirement: Non-interactive operations fail on unresolved collisions without modifying state

When a non-interactive operation encounters a collision group with no recorded resolution, the system SHALL fail with structured data identifying each colliding facet, each colliding asset, the shared namespace involved, and the available resolutions. The failure SHALL leave the project manifest, lockfile, receipt, and on-disk adapter state unchanged.

#### Scenario: CI install fails with structured collision data

- **WHEN** a non-interactive install encounters an unresolved collision between skill `review` in two facets
- **THEN** the operation SHALL exit with a non-zero status
- **AND** the failure data SHALL identify both facets, the colliding asset names, and the resolutions available
- **AND** no project or adapter state SHALL change

### Requirement: Collision resolutions are recorded and reproduced without prompting again

The system SHALL record each collision resolution as project intent alongside the facet's source declaration, and SHALL record the resulting effective materialized identities as resolved installation state. Subsequent installs, repairs, updates, frozen installs, and removals — on the same machine or another — SHALL reproduce the same effective asset set from the recorded intent without prompting. Existing compact string entries SHALL remain valid for facets that require no explicit resolution. A recorded resolution that references an asset the facet no longer declares SHALL be reported as stale with structured data and SHALL NOT by itself fail the operation.

#### Scenario: A teammate reproduces recorded resolutions without prompts

- **WHEN** a teammate clones a project whose recorded intent aliases skill `review` to `review-acme` and runs install
- **THEN** the install SHALL materialize `review-acme` without prompting
- **AND** the effective asset set SHALL match the machine where the resolution was recorded

#### Scenario: A facet without resolutions keeps its compact entry

- **WHEN** a project declares a facet that participates in no collision group
- **THEN** its manifest entry MAY remain a compact string
- **AND** installation SHALL NOT rewrite it into an enriched form to add empty resolution data

#### Scenario: A stale resolution is reported, not fatal

- **WHEN** a recorded resolution references an asset name the facet's resolved version no longer declares
- **THEN** the install SHALL complete for the assets the facet does declare
- **AND** the system SHALL report the stale resolution with structured data identifying the facet and the missing asset

### Requirement: Aliases satisfy the asset-name grammar and apply uniformly to every adapter

A materialized alias SHALL satisfy the same asset-name grammar and namespace rules as an authored asset name. One project-level resolution SHALL apply to every selected adapter: the system SHALL NOT record or apply adapter-specific aliases or adapter-specific omissions, and every selected adapter SHALL receive the same effective asset set.

#### Scenario: An invalid alias is rejected

- **WHEN** a user proposes the alias `Review--Code` or an alias longer than the permitted length
- **THEN** the system SHALL reject the alias with the naming constraint that failed
- **AND** no resolution SHALL be recorded

#### Scenario: The same effective set reaches every adapter

- **WHEN** a project with two selected adapters records an alias for a colliding skill
- **THEN** both adapters SHALL materialize the skill under the same effective name
- **AND** neither adapter SHALL receive an adapter-specific variant of the resolution

### Requirement: Omission excludes the asset and its owned companions from materialization

When a resolution omits an asset, the system SHALL NOT materialize the asset's primary file or any of its owned companion files into any adapter, and SHALL NOT record ownership of any file for the omitted asset. Other assets contributed by the same facet SHALL install normally.

#### Scenario: An omitted skill writes nothing

- **WHEN** a resolution omits skill `review`, which owns `SKILL.md` and two companions
- **THEN** no file belonging to that skill SHALL be written into any selected adapter
- **AND** the receipt SHALL record no owned file for the omitted skill

#### Scenario: Sibling assets of an omitted asset still install

- **WHEN** a facet contributes an omitted skill and a non-colliding agent
- **THEN** the agent SHALL be materialized normally
- **AND** the facet's lockfile entry SHALL still verify against its authored archive

### Requirement: Authored identities govern verification; effective identities govern materialized state

Integrity verification SHALL continue to use the facet's authored asset identities and canonical archive paths: aliasing SHALL NOT change any archive path, per-file integrity value, or archive integrity value. The receipt, drift repair, and removal SHALL operate on effective materialized identities: the system SHALL record as owned exactly the files it materialized under effective names, SHALL repair drift at those effective paths, and SHALL delete exactly the recorded owned files on removal.

#### Scenario: An aliased skill verifies against its authored archive paths

- **WHEN** skill `review` is materialized under alias `review-acme`
- **THEN** integrity verification SHALL check the archive entries under the authored `skills/review/` paths
- **AND** verification SHALL NOT look for `review-acme` inside the archive

#### Scenario: Drift repair restores the aliased path

- **WHEN** a file of a skill materialized under an alias is modified on disk
- **THEN** re-running install SHALL repair the file at its effective materialized path
- **AND** the repaired content SHALL reproduce the authored file's locked integrity

#### Scenario: Removal deletes the aliased files, not the authored names

- **WHEN** a user removes a facet whose skill was materialized under an alias
- **THEN** the system SHALL delete the files recorded as owned at their effective materialized paths
- **AND** the system SHALL NOT attempt deletion under the authored name
- **AND** no file owned by another facet SHALL be deleted

### Requirement: Frozen installation reproduces resolved collision state or fails without rewriting

Frozen installation SHALL reproduce recorded collision resolutions exactly and SHALL NOT prompt. When frozen installation encounters an unresolved collision — including one introduced by lockfile or manifest edits pulled from version control — it SHALL fail before any materialization write and SHALL NOT rewrite the manifest, lockfile, receipt, or adapter state.

#### Scenario: Frozen install reproduces recorded aliases

- **WHEN** a frozen install runs on a project whose recorded intent and lockfile carry collision resolutions
- **THEN** the system SHALL materialize the recorded effective asset set exactly
- **AND** the system SHALL NOT prompt or re-resolve anything

#### Scenario: Frozen install fails on an unresolved collision

- **WHEN** a frozen install computes a desired asset set containing a collision no recorded resolution covers
- **THEN** the operation SHALL fail before any file is written
- **AND** the manifest, lockfile, receipt, and adapter state SHALL be unchanged

### Requirement: Successful normal operations migrate legacy project manifests transactionally

A legacy unversioned string-only project manifest SHALL remain valid input. A successful normal (non-frozen) operation that writes the project manifest SHALL migrate it to the current versioned format in the same transaction as the rest of the operation's state; a failed operation SHALL leave the legacy manifest byte-for-byte untouched. Frozen installation SHALL accept a legacy manifest and SHALL NOT rewrite it.

#### Scenario: A successful add migrates the legacy manifest

- **WHEN** a user successfully adds a facet to a project with a legacy unversioned manifest
- **THEN** the written manifest SHALL carry the current format version
- **AND** every previously declared entry SHALL be preserved with unchanged meaning

#### Scenario: A failed operation does not migrate

- **WHEN** an operation on a project with a legacy manifest fails after resolution begins
- **THEN** the manifest SHALL remain in its legacy form, unchanged

#### Scenario: Frozen install retains the legacy manifest

- **WHEN** a frozen install runs on a project with a legacy unversioned manifest and a covering lockfile
- **THEN** the install MAY proceed
- **AND** the manifest SHALL NOT be rewritten

## MODIFIED Requirements

### Requirement: Lockfile declares a version

The lockfile SHALL declare `lockfileVersion`. Current lockfiles SHALL use numeric `0.3`. Version selection SHALL use exact equality rather than numeric ordering: numeric `1` SHALL identify only the closed-alpha schema, numeric `0.2` SHALL identify only the preceding alpha schema, and numeric `0.3` SHALL identify only the current schema. Missing or unsupported versions SHALL produce structured rejection data.

A normal install MAY migrate a verified legacy numeric-`1` or numeric-`0.2` lockfile to `0.3` only after the resolved artifacts satisfy every current integrity check. Frozen installation SHALL retain legacy behavior without rewriting a numeric-`1` or numeric-`0.2` lockfile, and SHALL fail without rewriting any state when the project's recorded intent carries collision resolutions that the legacy lockfile format cannot represent. A current `0.2` archive SHALL require a `0.2`-or-current lockfile in frozen mode. Before a future stable lockfile v1 reuses numeric `1`, legacy-alpha support SHALL be removed and old-shape files SHALL receive actionable delete-and-regenerate guidance rather than shape-based reinterpretation.

#### Scenario: Missing lockfile version

- **WHEN** a lockfile omits `lockfileVersion`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Current lockfile version is accepted

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.3` and satisfies the current schema
- **THEN** the system SHALL accept it as current

#### Scenario: Preceding alpha version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.2`
- **THEN** the system SHALL interpret it under the preceding alpha schema only
- **AND** it SHALL NOT infer a schema from the remaining shape

#### Scenario: Legacy alpha version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** the system SHALL interpret it under the closed-alpha schema only
- **AND** it SHALL NOT infer a schema from the remaining shape

#### Scenario: Unsupported lockfile version is rejected

- **WHEN** a lockfile declares an unsupported version
- **THEN** the system SHALL reject it with structured data identifying the observed and supported versions

#### Scenario: Normal install migrates verified legacy state

- **WHEN** a non-frozen install loads a valid legacy `1` or `0.2` lockfile and verifies the resolved artifacts
- **THEN** it MAY write an equivalent `0.3` lockfile after successful installation

#### Scenario: Frozen install does not migrate legacy state

- **WHEN** frozen installation uses a valid legacy lockfile whose format can represent the project's recorded intent
- **THEN** it SHALL retain legacy behavior and SHALL NOT rewrite the lockfile

#### Scenario: Frozen install fails when resolutions require the current format

- **WHEN** frozen installation runs on a project whose recorded intent carries collision resolutions
- **AND** the lockfile declares a legacy version that cannot represent effective materialized identities
- **THEN** the operation SHALL fail without rewriting any state

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every current facet entry SHALL include an `assets` array. Each member SHALL record the authored `scope`, `type`, `name`, and a required `files` array sorted deterministically by canonical path. `scope` SHALL be `system`, `user`, or `project`; `type` SHALL be `skill`, `agent`, or `command`. Each file record SHALL contain canonical inner-archive `path` and `sha256:<hex>` `integrity` over canonical archive bytes. The lockfile SHALL contain no adapter-specific fields or adapter-encoded hashes.

When a recorded resolution assigns the asset a materialized alias, the entry SHALL additionally record the effective materialized name, which SHALL satisfy the same asset-name grammar as an authored name. When a recorded resolution omits the asset, the entry SHALL record the omission. An entry recording neither an alias nor an omission SHALL denote materialization under the authored name. Aliasing and omission SHALL NOT change any file record: `files` SHALL continue to list canonical inner-archive paths and integrity values derived from the authored archive.

A skill's file records SHALL include `skills/<name>/SKILL.md` and every declared companion. An agent or command SHALL contain exactly its conventional primary file record. Companions SHALL remain subordinate to their owning skill and SHALL NOT become independent assets or receive their own scopes. Archive-only supplementary files SHALL NOT appear in an asset's files.

#### Scenario: Valid multi-file skill entry

- **WHEN** a skill named `planning` owns `SKILL.md` and two companions
- **THEN** its lockfile asset entry SHALL contain three sorted canonical file records with integrity values

#### Scenario: Valid single-file asset entry

- **WHEN** an agent entry has `scope: "user"`, `type: "agent"`, and `name: "reviewer"`
- **THEN** its `files` array SHALL contain exactly `agents/reviewer.md` and its integrity

#### Scenario: Aliased asset records both identities

- **WHEN** skill `review` is materialized under the alias `review-acme`
- **THEN** its lockfile asset entry SHALL record the authored name `review` and the effective materialized name `review-acme`
- **AND** its `files` array SHALL still list the canonical `skills/review/...` archive paths

#### Scenario: Omitted asset records its omission

- **WHEN** a recorded resolution omits command `deploy`
- **THEN** the lockfile asset entry for `deploy` SHALL record the omission
- **AND** the entry SHALL retain its authored identity and file records so the archive remains verifiable

#### Scenario: Missing files array is rejected

- **WHEN** a current asset entry omits `files`
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
