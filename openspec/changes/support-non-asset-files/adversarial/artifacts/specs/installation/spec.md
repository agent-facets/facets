## MODIFIED Requirements

### Requirement: Lockfile declares a version

The lockfile SHALL include a top-level `lockfileVersion`. The current version SHALL be `0.2`. Version recognition SHALL use exact equality, never numeric ordering: the legacy numeric version `1` SHALL be recognized only as the previous schema, and `0.2` SHALL identify the current schema. A lockfile declaring any other version, or omitting the version, SHALL be rejected with an actionable error.

A normal (non-frozen) install MAY migrate a verified legacy version-`1` lockfile to `0.2`, recording per-file integrity from the freshly verified content. A frozen install of a legacy lockfile SHALL retain legacy behavior and SHALL NOT rewrite the lockfile.

#### Scenario: Missing lockfile version

- **WHEN** a lockfile omits `lockfileVersion`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Current lockfile version is accepted

- **WHEN** a lockfile declares `lockfileVersion: 0.2` and satisfies the current schema
- **THEN** the system SHALL accept the lockfile

#### Scenario: A legacy lockfile migrates on a normal install

- **WHEN** a project has a legacy version-`1` lockfile
- **AND** the user runs a normal (non-frozen) install that verifies the locked content
- **THEN** the system SHALL write the lockfile as version `0.2`, including per-file integrity records derived from the verified content

#### Scenario: A frozen install does not rewrite a legacy lockfile

- **WHEN** a project has a legacy version-`1` lockfile
- **AND** the user runs install in frozen-lockfile mode
- **THEN** the system SHALL apply the legacy lockfile's behavior
- **AND** the system SHALL NOT write the lockfile

#### Scenario: An unrecognized lockfile version is rejected

- **WHEN** a lockfile declares a `lockfileVersion` that is neither the legacy `1` nor `0.2`
- **THEN** the system SHALL fail with an error identifying the unsupported version
- **AND** the system SHALL leave the project unchanged

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every facet entry SHALL include an `assets` array whose members carry the asset's adapter-agnostic identity — `scope`, `type`, `name` — plus a required, deterministically sorted `files` array of `{ path, integrity }` records covering every file the asset materializes. `scope` SHALL be one of `system | user | project`. `type` SHALL be one of `skill | agent | command`. Each file record's `path` SHALL be the canonical inner-archive path and its `integrity` the `sha256:<hex>` hash of that archive entry's canonical bytes. A skill entry's `files` SHALL contain the skill's primary file plus every declared companion file; an agent or command entry's `files` SHALL contain exactly its one primary file. Archive-only supplementary files SHALL NOT appear in any asset's `files` and SHALL NOT form asset entries of their own. No per-adapter fields live here — the installer applies the asset set to every selected adapter ("same thing per adapter"), and recorded hashes SHALL be adapter-agnostic canonical hashes, never adapter-encoded representations.

#### Scenario: Valid asset entry with file records

- **WHEN** an asset entry has `scope: "user"`, `type: "skill"`, `name: "planning"`, and a sorted `files` array pinning the skill's primary file and its declared companions
- **THEN** the system SHALL accept the entry

#### Scenario: Unknown asset scope

- **WHEN** an asset entry has `scope: "global"`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Unknown asset type

- **WHEN** an asset entry has `type: "hook"`
- **THEN** the system SHALL reject the lockfile

#### Scenario: An asset entry without file records is rejected

- **WHEN** a `0.2` lockfile asset entry omits its `files` array
- **THEN** the system SHALL reject the lockfile

#### Scenario: Supplementary files never become asset entries

- **WHEN** the system writes a lockfile entry for a facet that ships archive-only supplementary files
- **THEN** those files SHALL NOT appear as members of the `assets` array
- **AND** they SHALL NOT appear inside any asset's `files` records

## ADDED Requirements

### Requirement: Install reconciles per-file integrity before any write

Before materializing a facet, the system SHALL require exact agreement among: (1) the lockfile's facet-level integrity and the recomputed archive integrity; (2) the lockfile's asset identities and the verified materialization plan derived from the archive; (3) each lockfile asset's complete file path set and the files that asset actually owns in the verified archive; and (4) each recorded per-file integrity, the recomputed hash of the corresponding archive entry, and the archive's own verified per-entry hash record. Any disagreement SHALL fail the install before any asset is written, with structured failure data identifying the facet, the asset, the exact canonical path, the expected integrity, and the observed integrity when available. In frozen-lockfile mode a disagreement SHALL fail without rewriting the lockfile; in normal mode the system MAY write a new lockfile entry only after all checks pass against the newly resolved artifact.

#### Scenario: A tampered companion file is caught before materialization

- **WHEN** the system installs a locked facet whose archive entry for one skill companion no longer hashes to the lockfile's recorded per-file integrity
- **THEN** the system SHALL abort the install before writing any asset
- **AND** the failure SHALL identify the facet, the owning skill, the exact companion path, and the expected and observed hashes

#### Scenario: A lockfile file set that disagrees with the archive is caught

- **WHEN** a locked skill's recorded file path set differs from the set of files that skill owns in the verified archive (a missing companion record or an extra one)
- **THEN** the system SHALL abort the install with a structured failure identifying the divergent paths

#### Scenario: Drift reports name the exact locked path

- **WHEN** the system checks materialized state against the lockfile and a materialized file no longer matches its recorded canonical integrity
- **THEN** the report SHALL identify the exact locked path that drifted
- **AND** the report SHALL NOT collapse the drift to a facet-level or asset-level mismatch without the path

### Requirement: Skill companion files materialize and remove atomically with their skill

Declared skill companion files SHALL be installed with their owning skill as one all-or-nothing unit: after a successful install, the skill's primary file and every declared companion are present; after a failed install, no partial skill state remains. Updating a skill SHALL replace its companion set — previously installed companions absent from the new set SHALL be removed in the same operation. Removing a skill SHALL remove its primary file and every companion the system installed for it, and SHALL NOT delete files inside the skill's storage location that the system did not install. Files the install writes SHALL be committed together with the lockfile and receipt in the same transaction; a failure SHALL roll back materialized files, lockfile, and receipt together.

#### Scenario: A skill with companions installs completely or not at all

- **WHEN** the system installs a skill declaring three companion files and any write fails partway
- **THEN** the skill's storage location SHALL NOT retain a partial bundle
- **AND** the manifest, lockfile, and receipt SHALL remain as they were before the operation

#### Scenario: An update removes companions dropped from the declaration

- **WHEN** an installed skill previously included companion `references/old.md`
- **AND** the newly installed version of that skill no longer declares it
- **THEN** the update SHALL remove `references/old.md` from the skill's storage location
- **AND** the remaining companions SHALL match the new declaration exactly

#### Scenario: Removing a skill preserves unowned files

- **WHEN** a user removes a facet whose skill directory also contains a file the system never installed
- **THEN** the system SHALL delete the skill's primary file and its installed companions
- **AND** the system SHALL NOT delete the unowned file

### Requirement: Archive-only supplementary files ship but are never materialized

Files declared outside skill directories — such as a root `README.md`, `LICENSE`, or extra files alongside agents and commands — SHALL travel in the installed facet's verified archive but SHALL NOT be written to any adapter tree or other install destination. They SHALL NOT acquire an install scope, an asset type, or any independent installable identity. Their integrity SHALL remain protected by the facet-level archive integrity.

#### Scenario: A facet with a README installs without writing it

- **WHEN** a user installs a facet whose archive contains a declared root `README.md`
- **THEN** the install SHALL succeed
- **AND** no `README.md` SHALL be written to any adapter tree or install destination
- **AND** the facet's assets SHALL materialize normally

#### Scenario: Supplementary files do not affect the installed asset set

- **WHEN** two facets differ only in their archive-only supplementary files
- **THEN** their materialized asset trees SHALL be identical

### Requirement: The receipt records the complete owned file set of each materialized asset

For every materialized asset, the receipt SHALL record the complete set of files the system installed for it — for a skill, the primary file and every installed companion — mirroring the lockfile ownership that was successfully committed. This SHALL be sufficient to remove the asset's every installed file later without the cache, the network, or the lockfile, including after a pulled lockfile change drops the entry. The receipt SHALL remain adapter-agnostic and SHALL NOT store adapter-encoded content hashes. The receipt SHALL remain untrusted input: recorded paths SHALL be validated for containment before deletion, and a recorded path resolving outside the project's adapter trees SHALL NOT be deleted. A legacy receipt that predates companion support MAY be interpreted as recording primary files only, because no companions could have been installed under it.

#### Scenario: Offline removal deletes every owned companion

- **WHEN** a facet whose skill installed companion files is removed while the cache is empty and the registry unreachable
- **THEN** the system SHALL delete the skill's primary file and every companion recorded in the receipt
- **AND** the removal SHALL succeed without network access

#### Scenario: A pulled change that drops a multi-file skill cleans up its companions

- **WHEN** a change pulled from version control removes a facet with a multi-file skill from the manifest and lockfile
- **AND** the receipt records that skill's installed file set
- **THEN** the next install SHALL remove the primary file and every recorded companion
- **AND** no companion SHALL be left orphaned on disk

#### Scenario: A receipt path outside the adapter trees is never deleted

- **WHEN** a receipt records a companion path that resolves outside the project's adapter trees
- **THEN** the system SHALL NOT delete that path
- **AND** the system SHALL report the invalid entry
- **AND** valid recorded paths SHALL still be processed normally

### Requirement: Unsupported archive formats fail install with actionable guidance

When an install encounters a facet artifact whose declared archive format version the system does not support, the system SHALL fail with a structured error carrying the observed version and the supported versions, and SHALL leave the manifest, lockfile, receipt, and adapter state unchanged. The rendered error SHALL tell the user to update the tool: for a known newer format, it SHALL name the minimum release that supports it; for an unknown future format, it SHALL advise updating to the latest release without inventing a minimum version.

#### Scenario: A newer known format produces upgrade guidance

- **WHEN** a user installs a facet whose archive declares a format version this release does not support but a published newer release does
- **THEN** the install SHALL fail with a structured unsupported-version error
- **AND** the rendered message SHALL name the minimum release that supports the format
- **AND** the project SHALL remain unchanged

#### Scenario: An unknown future format advises updating

- **WHEN** a user installs a facet whose archive declares a format version unknown to any published release this system knows of
- **THEN** the install SHALL fail with a structured unsupported-version error
- **AND** the rendered message SHALL advise updating to the latest release

#### Scenario: Legacy archives continue to install

- **WHEN** a user installs a facet whose archive uses the legacy asset-only format
- **THEN** the install SHALL verify and materialize it under the legacy format's rules
- **AND** the install SHALL succeed for a valid legacy archive
