## MODIFIED Requirements

### Requirement: Lockfile declares a version

The lockfile SHALL declare `lockfileVersion`. Current lockfiles SHALL use numeric `0.4`. Version selection SHALL use exact equality rather than numeric ordering: numeric `0.2`, `0.3`, and `0.4` SHALL each identify only their own schema. Shape inference and cross-version fallback SHALL NOT occur. Missing or unsupported versions SHALL produce structured rejection data.

Numeric `1` SHALL NOT be readable. It named a withdrawn closed-alpha shape and is reserved for a future stable v1, so a lockfile declaring it SHALL be rejected as an unsupported version, and the rejection SHALL offer actionable delete-and-regenerate guidance rather than reinterpreting the document from its remaining shape.

Every successful non-frozen install SHALL write `0.4`, including when no materialization overrides exist. A `0.2` or `0.3` lockfile with remaining facets SHALL be migrated only after their resolved artifacts satisfy every current integrity check and their complete server inventories have been derived from verified definitions. Earlier `0.2` assets SHALL refine to authored materialization. A removal-only operation SHALL carry complete `0.4` remaining inventories forward without re-verification only when the published local-witness conditions hold; remaining legacy entries SHALL require ordinary verified resolution. Removing every facet SHALL permit an empty `0.4` result without fetching removed content. Removing overrides SHALL NOT downgrade the lockfile.

Frozen installation SHALL NOT rewrite any supported lockfile and SHALL reject materialization intent its format cannot represent. Asset dispositions SHALL be representable in exactly `0.3` and `0.4`; server dispositions SHALL be representable only in `0.4`. Legacy server inventory SHALL remain unavailable rather than being inferred as empty.

#### Scenario: Missing lockfile version

- **WHEN** a lockfile omits `lockfileVersion`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Current lockfile version is accepted

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.4` and satisfies the current schema
- **THEN** the system SHALL accept it as current

#### Scenario: Previous version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.2`
- **THEN** the system SHALL interpret it only under the `0.2` schema
- **AND** each asset SHALL be understood as authored materialization

#### Scenario: Version 0.3 remains readable

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.3` and satisfies that schema
- **THEN** the system SHALL retain its asset dispositions without reinterpreting it as `0.4`
- **AND** it SHALL NOT infer server inventory from missing fields or extensions

#### Scenario: Withdrawn alpha version is rejected with recovery guidance

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** the system SHALL reject it as an unsupported version
- **AND** it SHALL NOT infer a schema from the remaining shape
- **AND** the failure SHALL tell the user to delete the lockfile and regenerate it with a normal install

#### Scenario: Unsupported lockfile version is rejected

- **WHEN** a lockfile declares an unsupported version
- **THEN** the system SHALL reject it with structured observed and supported versions

#### Scenario: Normal install migrates verified earlier state

- **WHEN** a non-frozen install loads a valid `0.2` or `0.3` lockfile and verifies every resolved artifact
- **AND** installation succeeds
- **THEN** it SHALL write `0.4` with equivalent authored asset records and complete server inventories derived from the verified definitions

#### Scenario: Resolution-free project still migrates

- **WHEN** a non-frozen install succeeds without any override
- **THEN** the committed lockfile SHALL declare `0.4`

#### Scenario: Frozen install does not migrate

- **WHEN** frozen installation uses a `0.2` or `0.3` lockfile whose consistency checks pass
- **THEN** it SHALL NOT rewrite the lockfile

#### Scenario: Frozen install fails when resolutions require the current format

- **WHEN** frozen installation uses a supported legacy lockfile
- **AND** the project manifest records materialization intent that format cannot represent
- **THEN** the operation SHALL fail before fetching facet content and without rewriting any state
- **AND** it SHALL report required version `0.3` for an asset-only refusal against `0.2`, or `0.4` for a server-override refusal against a legacy format
- **AND** guidance SHALL explain that a normal installation writes the current `0.4` format

#### Scenario: Frozen install rejects a withdrawn alpha lockfile

- **WHEN** frozen installation encounters a lockfile declaring numeric `lockfileVersion: 1`
- **THEN** it SHALL fail on the unsupported version without rewriting any state

#### Scenario: A failed migration does not publish partial inventory

- **WHEN** a migration cannot obtain or verify a remaining facet's definitions
- **THEN** it SHALL fail without committing manifest, lockfile, receipt, asset, or native configuration changes
- **AND** it SHALL NOT substitute an empty server inventory

#### Scenario: Discovery and dry-run do not migrate inventory

- **WHEN** version discovery, update discovery, or an update dry-run reads a valid `0.2`, `0.3`, or `0.4` lockfile
- **THEN** the shared files SHALL remain byte-for-byte unchanged
- **AND** no facet content SHALL be fetched or rebuilt merely to inspect locked versions
- **AND** declarations SHALL NOT be resolved merely to populate missing legacy inventory

### Requirement: Each facet entry records source provenance

For every facet in `facets`, the lockfile SHALL record the facet's source provenance using a tagged shape whose form depends on the source kind. Each entry's source SHALL declare its kind and carry only the provenance fields meaningful for that kind:

- A **registry** source SHALL record the registry origin (the base URL the artifact was resolved from). A registry source SHALL NOT carry a version specifier; the entry's `version` field is the resolved identity and the facet name is the entry key.
- A **git** source SHALL record the repository URL and the resolved commit SHA. The commit SHALL be required, because it is the immutable identity that makes the install reproducible. The git source SHALL NOT record the symbolic ref: the ref is what the user requested and is recorded in the project manifest, whereas the lockfile records what was resolved.
- A **local** source SHALL record the resolved path.

Source-provenance fields SHALL live inside the source value (there are no top-level ref or commit fields; the git commit lives inside the git source). A lockfile entry whose source does not declare a recognized kind, or whose source omits a field required for its declared kind (such as a git source without a commit), SHALL be rejected. Consistent with the lockfile's general unknown-field tolerance, additional unrecognized source keys SHALL be accepted when required fields satisfy the selected schema.

#### Scenario: Valid registry-source entry

- **WHEN** an otherwise schema-valid facet entry declares a registry source recording the registry base URL, together with its required identity and contribution fields
- **THEN** the system SHALL accept the entry

#### Scenario: Registry-source entry never carries a version specifier

- **WHEN** the system writes a lockfile entry for a registry-sourced facet
- **THEN** the recorded source SHALL NOT contain a version specifier of any form (an exact version, a wildcard such as `1.*` or `*`, or the `latest` tag)
- **AND** the resolved version SHALL be recorded only in the entry's `version` field

#### Scenario: Valid git-source entry

- **WHEN** an otherwise schema-valid facet entry declares a git source recording the repository URL and the resolved commit SHA, together with its required identity and contribution fields
- **THEN** the system SHALL accept the entry

#### Scenario: Git-source entry without a commit is rejected

- **WHEN** a lockfile facet entry declares a git source that records a repository URL but no resolved commit
- **THEN** the system SHALL reject the entry

#### Scenario: Valid local-source entry

- **WHEN** an otherwise schema-valid facet entry declares a local source recording the resolved path, together with its required identity and contribution fields
- **THEN** the system SHALL accept the entry

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every current facet entry SHALL include an `assets` array. Each member SHALL record authored `scope`, `type`, and `name`, a required materialization disposition, and a required `files` array sorted deterministically by canonical authored path. `scope` SHALL be `system`, `user`, or `project`; `type` SHALL be `skill`, `agent`, or `command`. Each file record SHALL contain canonical inner-archive `path` and `sha256:<hex>` `integrity` over canonical archive bytes. The lockfile SHALL contain no schema-defined adapter-specific fields, hashes, or dispositions.

The disposition SHALL state authored, aliased with a valid effective name, or omitted. Omitted assets SHALL remain listed with every authored file record. A skill's file records SHALL include `skills/<name>/SKILL.md` and every declared companion. An agent or command SHALL contain exactly its conventional primary file record. Skill companions SHALL remain subordinate to their owning skill, follow its disposition, and SHALL NOT become independent assets or receive their own scopes. Archive-only supplementary files SHALL NOT appear in an asset's files.

Every file record SHALL be derived from its own asset's authored type and name, not merely be a safe, sorted, non-duplicate path. An agent or command entry SHALL contain exactly one record at its canonical primary path; every record in a skill entry SHALL lie beneath that skill's authored root and SHALL include its canonical primary file. A record that no derivation from the owning asset's authored identity could produce SHALL be rejected, so ownership and integrity are never associated with an unrelated archive file. These rules SHALL apply to `0.2`, `0.3`, and `0.4` entries.

#### Scenario: Valid multi-file skill entry

- **WHEN** a skill owns `SKILL.md` and two companions
- **THEN** its current entry SHALL contain three sorted authored file records and a disposition

#### Scenario: Valid single-file asset entry

- **WHEN** an agent entry records scope, type, and authored name `reviewer`
- **THEN** its files SHALL contain exactly `agents/reviewer.md` and its integrity

#### Scenario: Missing files array is rejected

- **WHEN** a `0.3` or `0.4` asset entry omits `files`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Missing disposition is rejected

- **WHEN** a `0.3` or `0.4` asset entry omits materialization
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

#### Scenario: File record unrelated to its asset is rejected

- **WHEN** a command entry records a safe, sorted file record whose path is not that command's canonical primary path
- **THEN** the system SHALL reject the lockfile
- **AND** the rejection SHALL apply equally to `0.2`, `0.3`, and `0.4` entries

#### Scenario: Unknown asset scope

- **WHEN** an asset scope is `global`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Unknown asset type

- **WHEN** an asset type is `hook`
- **THEN** the system SHALL reject the lockfile

### Requirement: Unrecognized fields are tolerated

The system SHALL accept lockfiles containing fields not defined in the selected schema. Unrecognized fields SHALL be preserved, not stripped or rejected.

Preservation SHALL survive reconstruction, not only loading. When the system rewrites a lockfile, it SHALL carry forward the unrecognized fields of the top-level document, of every facet entry it still records, of a retained facet's source when the source kind is unchanged, of every asset entry matched by authored scope, type, and name, of every file record matched by path, and of every previous `0.4` server record matched by authored name within its facet. Where a schema-defined field and an unrecognized field share a name, the schema-defined value SHALL win. Unrecognized fields belonging to a facet, asset, file record, or server record that the new state no longer contains SHALL be dropped with it.

When migrating `0.2` or `0.3`, an extension named `servers` SHALL be replaced by the verified canonical inventory. Its elements SHALL NOT be interpreted as records or as a source of server-record extensions, regardless of resemblance to the new schema. Other retained extension fields SHALL continue to be preserved.

#### Scenario: Unknown field in lockfile

- **WHEN** an otherwise valid lockfile contains a field not defined in its schema (e.g., `generatedAt: "2026-04-18"`)
- **THEN** the system SHALL accept the lockfile
- **AND** the field SHALL be present in the loaded result

#### Scenario: Unknown fields survive migration to the current version

- **WHEN** a non-frozen install migrates a `0.2` or `0.3` lockfile carrying unrecognized fields at the document, facet, source, asset, and file-record levels
- **THEN** the committed `0.4` lockfile SHALL retain those fields except names newly defined by the current schema
- **AND** equivalent preservation SHALL hold for a `0.4` rewrite, including retained server-record extensions

#### Scenario: Removed state takes its unknown fields with it

- **WHEN** a rewrite no longer records a facet that carried an unrecognized field
- **THEN** that field SHALL NOT appear in the rewritten lockfile

#### Scenario: Retained server extensions survive an alias change

- **WHEN** a `0.4` rewrite retains a facet and authored server name but changes its alias
- **THEN** the record's opaque extension fields SHALL survive
- **AND** its new canonical disposition and fingerprint SHALL take precedence over previous values

#### Scenario: Legacy extension contents are not promoted

- **WHEN** a legacy `servers` extension contains apparently valid records with extra fields
- **AND** installation migrates the facet to `0.4`
- **THEN** only verified definitions SHALL supply the canonical inventory
- **AND** the extension's contents SHALL NOT supply server-record metadata or extensions

#### Scenario: Removed server loses its extensions

- **WHEN** a verified update no longer declares a previously recorded server
- **THEN** that server's record and its extension fields SHALL be absent from the new lockfile

### Requirement: Frozen-lockfile install treats the lockfile as authoritative

The system SHALL provide a frozen-lockfile mode for install in which the manifest and lockfile are treated as authoritative and reproduced exactly: no extra facets, no missing facets, no source changes, no content changes, and no recorded materialization-intent changes. In this mode the system SHALL NOT perform version resolution, prompt for collision choices, migrate or write the manifest, or write the lockfile. Content download for a locked exact version absent from the cache SHALL remain permitted after pre-fetch consistency checks pass, because downloading already-locked bytes is reproduction, not drift. Because adding or removing a facet changes the locked set, the system SHALL reject a frozen-lockfile operation that carries any explicit add or removal before inspecting the lockfile.

Before fetching content, cleanup, or materialization, the system SHALL verify that the manifest uses a supported form and that the lockfile fully and consistently covers its sources and every materialization disposition the selected format supports. The system SHALL fail without modifying the project if any of the following is true: the operation carries an explicit add or removal; no lockfile exists; the lockfile cannot be read or does not satisfy its selected published schema; the manifest declares an unsupported explicit version; the manifest declares a facet that has no lockfile entry; a lockfile entry's recorded version does not satisfy its manifest specifier; a manifest override requires a disposition its lockfile version cannot represent; overrides differ from recorded dispositions, name an absent recorded contribution, or leave an unresolved effective-name collision in the recorded set; the lockfile pins a facet the manifest no longer declares; or a git or local facet's manifest source string no longer matches its recorded provenance. Valid legacy unversioned manifests and supported earlier lockfiles SHALL remain reproducible without rewriting when their format-capability, source, content, and approval checks pass. Server checks for legacy formats without inventory SHALL continue from verified definitions after the pre-fetch gates pass.

When the lockfile fully covers the manifest, the system SHALL install exactly the versions, integrity hashes, and effective materialized contributions determined by the supported locked state, downloading any required locked content not cached. It SHALL verify that every facet, including cached content and local sources, reproduces its recorded integrity and SHALL fail if any content does not match. For `0.4`, the complete recorded server inventory SHALL additionally agree with the verified declarations before cleanup or materialization. Because frozen mode never creates a lockfile entry, it SHALL NOT require integrity confirmation against the registry; its only permitted network activity is downloading already-locked content.

Frozen mode constrains the locked set, not the machine's materialized state: assets that the receipt shows as materialized but that the lockfile-covered manifest no longer wants SHALL still be removed, and the receipt SHALL be updated to match, while the lockfile and manifest SHALL never be written. Receipt-driven cleanup SHALL begin only after every frozen consistency check passes.

#### Scenario: Frozen install proceeds when locked state covers intent

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** manifest sources and materialization intent exactly match supported locked state
- **AND** all content, adapter, native-state, and approval checks pass
- **THEN** the system SHALL reproduce exact versions, integrity, and effective contributions without version resolution or prompt
- **AND** it SHALL NOT write the manifest or lockfile

#### Scenario: Frozen mode downloads absent locked content

- **WHEN** a locked exact version's content is absent from the cache
- **AND** the pre-fetch consistency checks pass
- **THEN** the system SHALL download and verify that exact content
- **AND** it SHALL NOT treat the download as drift

#### Scenario: Frozen mode verifies cached content

- **WHEN** cached content differs from locked integrity
- **THEN** the system SHALL fail with an integrity error before materialization
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen verification is independent of cache warmth

- **WHEN** two frozen installs reproduce the same locked facet with warm and cold caches respectively
- **THEN** both SHALL verify and reconcile the same complete authored contributions
- **AND** both SHALL preserve the same authored companion content for materialization

#### Scenario: Frozen reproduction preserves companions

- **WHEN** a frozen install reproduces a skill whose primary and companions already match verified content
- **THEN** it SHALL treat the complete bundle as unchanged
- **AND** it SHALL NOT infer that the companion set is empty merely because content was obtained through a different acquisition path
- **AND** it SHALL NOT delete a verified desired companion

#### Scenario: Frozen mode cleans receipt-only orphan

- **WHEN** manifest and lockfile both dropped a facet still present in the receipt
- **AND** all frozen consistency checks pass
- **THEN** receipt-driven cleanup SHALL remove its effective ownership
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

- **WHEN** manifest overrides disagree with recorded dispositions or leave a collision in the locked contribution set
- **THEN** frozen installation SHALL fail identifying the affected contributions
- **AND** it SHALL NOT fetch facet content, prompt, or write state

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

#### Scenario: Asset aliases remain representable in both disposition-bearing formats

- **WHEN** a `0.3` or `0.4` lockfile records an asset alias matching the project manifest
- **AND** all other frozen checks pass
- **THEN** frozen installation SHALL accept that asset disposition

#### Scenario: Asset-only format refusal reports capability rather than writer version

- **WHEN** a `0.2` lockfile is used with an asset override and no server override
- **THEN** frozen installation SHALL refuse before fetching with `requiredVersion: 0.3`
- **AND** its guidance SHALL explain that a normal install writes the current `0.4` format

### Requirement: Removing a facet uninstalls it

When a user removes a facet from a project, the system SHALL drop the facet from the project manifest, reconcile its effective materialized ownership across every selected adapter, and update the lockfile and receipt so neither records the facet, all in a single operation. A user SHALL NOT need to run a separate install step after removing. The ownership to reconcile SHALL be taken from the receipt alone, so deleting a tracked materialization SHALL require neither cache nor network access, and an untracked one SHALL delete nothing on disk. Whether the command as a whole completes without cache or network access SHALL additionally depend on complete locked inventory and witnessed remaining desired state under the refinement rules below. The system SHALL delete a recorded effective adapter identity only when no desired contribution retains it, SHALL delete each obsolete identity once, and SHALL aggregate historical duplicate claims so a retained desired contribution is never deleted. Skill deletion SHALL supply the validated authored companion ownership in the adapter deletion request and SHALL remove the primary and every obsolete owned companion atomically while leaving unowned files untouched. Each recorded owned file SHALL be inspected on its own terms, so a recorded primary that is already absent SHALL still permit removal of its recorded companions; a later failure SHALL restore them byte for byte.

A non-frozen removal-only operation SHALL NOT fetch, rebuild, or reverify a remaining facet whose current locked entry and receipt already answer the operation completely. It SHALL instead refine remaining entries from local state: confirm that every remaining facet has a locked entry matching its manifest source and specifier; evaluate the remaining locked asset and server sets under current project intent; retain each entry's source, version, integrity, asset file records, complete server inventory, recorded dispositions, and supported unrecognized fields; and reject offline refinement when remaining dispositions differ from intent or the remaining set conflicts. Known stale overrides SHALL be reported and pruned only in the successful transaction. The resulting lockfile SHALL use `0.4`. Remaining materializations SHALL NOT be rewritten or deleted, and lockfile entries for facets the manifest no longer declares SHALL be dropped.

If any facet remains under a `0.2` or `0.3` lockfile, the system SHALL fall back to ordinary verified resolution because those formats cannot supply complete server inventory. It SHALL NOT invent empty inventory from absent records, empty assets, or receipt claims, and SHALL NOT emit a legacy format instead. If no facet remains, no inventory for removed facets is needed; removal SHALL NOT fetch their content to produce an empty `0.4` lockfile. Existing receipt and adapter safety checks SHALL still apply. A frozen operation SHALL NOT refine, because it SHALL NOT rewrite the lockfile at all.

Because the lockfile is shared state and the receipt is machine-local, refinement SHALL require every remaining materialization to be tracked before writing: each remaining facet SHALL have a receipt record, and its version, facet integrity, materialized assets, asset dispositions, and owned file sets SHALL agree with the locked entry. Its active server records and recorded configuration claims SHALL agree in both directions on authored name, materialization disposition, and fingerprint. Omitted server records SHALL require no receipt claim and SHALL remain in the lockfile. Missing, unexpected, or conflicting active claims SHALL force ordinary resolution. An absent, corrupt, path-mismatched, or insufficient receipt SHALL NOT be replaced by lockfile-derived ownership. The committed receipt SHALL carry witnessed records forward rather than re-derive them from locked entries. An operation that materializes nothing SHALL NOT record an identity it did not already witness. Assets the receipt records but the remaining locked entries no longer list SHALL be dropped from the committed receipt while remaining subject to ownership reconciliation.

For text assets, refinement SHALL also confirm that every effective identity a remaining facet retains was previously claimed only by that facet. Identity comparison SHALL fold asset type into its materialization namespace and fold names portably, so case or Unicode-normalization differences and asset types sharing a namespace SHALL still identify contention. MCP identities with identical witnessed fingerprints SHALL remain shareable across facets. An identity no remaining facet retains SHALL NOT itself block refinement, because ownership reconciliation removes it.

A removal-only operation SHALL observe cancellation before deleting any materialized asset and again after deletion completes and before the manifest, lockfile, and receipt are written. A cancellation observed before deletion SHALL leave every file untouched and SHALL report that no mutation occurred; a cancellation observed after deletion SHALL roll the deletions back and report that outcome. Cancellation SHALL NOT be observed after the commit, which is the operation's transaction boundary.

Whether an operation is removal-only SHALL be decided from the requested change, not from how many requested names the project still declares. A request whose names are already absent SHALL remain eligible for refinement when its remaining state satisfies the same inventory and witness conditions.

Refinement SHALL apply only when local state answers the operation completely. The system SHALL fall back to ordinary resolution rather than guessing when the project has no lockfile; a remaining facet has no matching locked entry or predates complete server inventory; the remaining set conflicts; a retained text-asset identity was also claimed by a removed facet; the receipt is unavailable, lacks required configuration evidence, omits a remaining facet, or disagrees with remaining locked state; or current materialization intent differs from recorded dispositions. The offline guarantee covers complete, fully tracked, witnessed remaining state. If required resolution is unavailable, removal SHALL fail without deleting untracked files or committing project and adapter changes.

Before deleting any materialized asset, the system SHALL verify that every selected installed adapter loads as a valid adapter and declares an Adapter SDK API supported by the CLI. Missing, malformed, unsupported, or metadata-inconsistent declarations, or failure to load an adapter, SHALL fail before deletion and leave the project manifest, lockfile, receipt, and materialized assets unchanged. Every superseded contract in which adapters performed their own writes SHALL remain unsupported. This compatibility check SHALL require neither cache nor network access. After incompatibility is repaired, a removal whose remaining inventories and witnesses satisfy refinement SHALL remain possible without either resource.

#### Scenario: Removing a declared facet uninstalls it

- **WHEN** a user removes a facet declared in the project manifest
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** selected adapters load with a supported Adapter SDK API and return successful cleanup plans
- **THEN** its manifest entry, lockfile entry, receipt entry, and obsolete effective ownership SHALL be removed in one command

#### Scenario: Removing multi-file skill preserves unowned content

- **WHEN** a removed facet owns `skills/review/SKILL.md` and `skills/review/references/api.md` but not `skills/review/notes.txt`
- **AND** the primary is present on disk
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** selected adapters load with a supported Adapter SDK API and return successful cleanup plans
- **THEN** deletion SHALL remove the primary and obsolete owned companion
- **AND** it SHALL preserve `notes.txt`

#### Scenario: Other facets are left intact

- **WHEN** one facet is removed from a project with several facets
- **AND** no effective adapter identity transfers to another desired owner
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** selected adapters load with a supported Adapter SDK API and return successful cleanup plans
- **AND** no remaining override names an absent contribution
- **THEN** every other facet's manifest, locked metadata, receipt, and materialized files SHALL remain unchanged

#### Scenario: Other facet retaining an identity is not deleted

- **WHEN** another desired facet owns the same effective adapter identity after removal
- **AND** the remaining facet's content is available and reproduces its locked integrity
- **AND** the remaining effective contributions are collision-free
- **AND** selected adapters load with a supported Adapter SDK API and their native configuration documents are valid
- **AND** any required MCP approval is explicitly supplied
- **THEN** that identity SHALL remain and contain the desired owner's content

#### Scenario: Removing the last facet leaves an empty project

- **WHEN** the only declared facet is removed
- **AND** every selected installed adapter is valid and compatible
- **THEN** manifest and lockfile SHALL remain valid and contain no facets
- **AND** the lockfile SHALL use `0.4` without fetching the removed facet's content

#### Scenario: Removal works offline

- **WHEN** removed facet content is uncached and its registry unreachable
- **AND** every remaining entry has complete `0.4` inventory and every remaining materialization is witnessed with matching intent
- **AND** every selected installed adapter is valid and compatible
- **THEN** receipt ownership SHALL allow removal without any cache read or network access

#### Scenario: Untracked removal without resolution fails rather than deleting

- **WHEN** a removal's remaining desired state is untracked
- **AND** the content needed to materialize it is uncached and its registry unreachable
- **THEN** the operation SHALL fail
- **AND** it SHALL leave the manifest, lockfile, receipt, and every untracked file unchanged

#### Scenario: Untracked removal resolves when content is reachable

- **WHEN** a removal's remaining desired state is untracked
- **AND** the needed content is available and passes integrity verification
- **AND** the remaining contributions are collision-free and their desired asset paths and native server entries are absent
- **AND** selected adapters load with a supported Adapter SDK API and their native configuration documents are valid
- **AND** any required MCP approval is explicitly supplied
- **THEN** the operation SHALL materialize the remaining desired state and record ownership of it
- **AND** it SHALL drop the removed facet from the manifest and lockfile
- **AND** it SHALL leave the removed facet's untracked files on disk

#### Scenario: Removal succeeds when a remaining facet is unavailable

- **WHEN** a multi-facet project removes one facet
- **AND** a remaining facet's content is uncached and its registry unreachable
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** selected adapters load with a supported Adapter SDK API and return successful cleanup plans
- **THEN** removal SHALL succeed without fetching, rebuilding, or reverifying that remaining facet
- **AND** the committed lockfile SHALL declare the current version
- **AND** the remaining facet's recorded source, version, integrity, file records, server records, and supported unrecognized fields SHALL be unchanged
- **AND** its materialized assets SHALL be untouched

#### Scenario: Removing an already-absent facet stays offline

- **WHEN** every requested removal names a facet the project no longer declares
- **AND** a remaining facet's content is uncached and its registry unreachable
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** selected adapters load with a supported Adapter SDK API and return successful cleanup plans
- **AND** no remaining override names an absent contribution
- **THEN** removal SHALL succeed without fetching, rebuilding, or reverifying that remaining facet
- **AND** the project manifest SHALL be unchanged

#### Scenario: Unrecorded remaining intent is not applied by a removal

- **WHEN** a removal-only operation finds a remaining facet whose declared materialization intent differs from its recorded disposition
- **THEN** the system SHALL NOT record that intent without reconciling the resulting materialization
- **AND** the operation SHALL fall back to ordinary resolution instead of refining

#### Scenario: A remaining facet the receipt contradicts is not refined

- **WHEN** a removal-only operation finds a remaining facet the receipt records, whose locked entry describes a materialization the receipt does not
- **THEN** the operation SHALL fall back to ordinary resolution instead of refining
- **AND** the committed receipt SHALL NOT claim an identity this machine did not materialize

#### Scenario: A remaining facet the receipt omits entirely is not refined

- **WHEN** a removal-only operation finds a remaining facet the receipt does not record at all
- **THEN** the operation SHALL treat that facet's materialization as untracked
- **AND** it SHALL fall back to ordinary resolution instead of refining
- **AND** the committed receipt SHALL record only the identities the operation reconciled

#### Scenario: A receipt that cannot be loaded is not refined

- **WHEN** a removal-only operation finds an absent, corrupt, or path-mismatched receipt
- **THEN** the operation SHALL fall back to ordinary resolution instead of refining
- **AND** it SHALL reconcile remaining materialized assets before recording their identities
- **AND** it SHALL NOT delete any untracked file

#### Scenario: An identity a removed facet also claimed is rematerialized

- **WHEN** a removal drops a facet that claimed the same effective text-asset identity a remaining facet retains
- **THEN** the operation SHALL fall back to ordinary resolution instead of refining
- **AND** the retained identity SHALL end the operation containing the remaining facet's content

#### Scenario: An identity contested only by removed facets does not block refinement

- **WHEN** the facets a removal drops contested an effective identity no remaining facet retains
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** selected adapters load with a supported Adapter SDK API and return successful cleanup plans
- **THEN** the operation SHALL still refine
- **AND** it SHALL delete that owned identity without fetching, rebuilding, or reverifying any remaining facet

#### Scenario: A removal cancelled before deletion changes nothing

- **WHEN** a removal-only operation is cancelled before it deletes any materialized asset
- **THEN** the manifest, lockfile, receipt, and materialized assets SHALL remain unchanged
- **AND** the failure SHALL report that no rollback was needed

#### Scenario: A removal cancelled after deletion is rolled back

- **WHEN** a removal-only operation is cancelled after deleting materialized assets and before committing
- **THEN** the system SHALL restore the deleted assets
- **AND** the manifest, lockfile, and receipt SHALL remain unchanged

#### Scenario: Remaining unrecognized fields survive an offline removal

- **WHEN** a removal-only operation refines a `0.4` lockfile whose retained entry and server record carry unrecognized fields
- **THEN** the committed lockfile SHALL still contain those fields

#### Scenario: Removing an untracked facet deletes nothing from disk

- **WHEN** a successful removal drops a facet whose materialization no receipt record covers
- **THEN** the manifest and lockfile SHALL no longer declare it
- **AND** the system SHALL NOT delete any file on its behalf
- **AND** the outcome SHALL be reported distinctly from a removal that reconciled tracked ownership, so it is not presented as having deleted files

#### Scenario: Incompatible adapter blocks removal

- **WHEN** a selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** no remaining override names an absent contribution
- **THEN** removal SHALL fail before deleting materialized assets
- **AND** the project manifest, lockfile, receipt, and materialized assets SHALL remain unchanged
- **AND** the failure SHALL NOT require or result from cache access or network access
- **AND** after the adapter is repaired to load with a supported Adapter SDK API and produce successful cleanup plans, removal SHALL succeed without cache or network access

#### Scenario: Legacy remaining entries require verified migration

- **WHEN** removal leaves at least one facet under a `0.2` or `0.3` lockfile
- **THEN** it SHALL resolve and verify the remaining content before writing `0.4`
- **AND** it SHALL NOT derive inventory from the receipt or from legacy `servers` extensions

#### Scenario: Unavailable legacy migration leaves all project state intact

- **WHEN** a legacy removal fallback cannot obtain verified content for a remaining facet
- **THEN** removal SHALL fail without committing project or adapter changes
- **AND** the failure SHALL retain the underlying cause and explain that migration requires the remaining facet's content

#### Scenario: Last-facet removal needs no legacy inventory

- **WHEN** removing all facets from a legacy project leaves no desired facets
- **AND** removed content is unavailable
- **THEN** the system SHALL perform no facet-content fetch to complete the empty locked set
- **AND** only valid receipt evidence SHALL authorize any cleanup

#### Scenario: Omitted server records survive removal without receipt claims

- **WHEN** a remaining `0.4` facet has an omitted server with no receipt claim
- **AND** its receipt agrees with every active locked asset and server record on authored identity, disposition, and applicable file-integrity or declaration-fingerprint values
- **THEN** that omission SHALL NOT force content resolution
- **AND** the complete omitted record SHALL survive the lockfile rewrite

#### Scenario: Known stale server intent is pruned transactionally

- **WHEN** removal leaves facet `kept` and its manifest overrides server `gone`, which its complete `0.4` inventory does not contain
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** selected adapters load with a supported Adapter SDK API and return successful cleanup plans
- **THEN** a successful removal SHALL report and prune that override without fetching facet content
- **AND** a failed removal SHALL leave the override unchanged

#### Scenario: Successful removal drops obsolete receipt assets

- **WHEN** a receipt records an owned command `retired` that no facet in the post-removal locked set lists
- **AND** the removal succeeds
- **THEN** the committed receipt SHALL no longer record that command
- **AND** cleanup of its materialization SHALL use the prior receipt's ownership evidence

### Requirement: MCP aliases and omissions are durable project intent

A server alias SHALL change only the effective configuration name and SHALL NOT change the authored declaration, declaration fingerprint, or facet integrity. An omission SHALL remove the declaration from active composition while retaining its complete authored record in a `0.4` lockfile. One disposition SHALL apply across every selected adapter. Recorded server dispositions SHALL survive source changes, failed operations, and disappearance of the collision that motivated them.

When a disposition names a server absent from the resolved facet, a successful non-frozen operation SHALL report and prune it in the final commit. A failed operation SHALL preserve it. Frozen installation SHALL NOT prune it: `0.4` SHALL report the stale intent from the locked inventory before fetch, while supported legacy formats with any server override SHALL refuse for insufficient format capability before fetch.

#### Scenario: Alias survives reproduction

- **WHEN** committed project intent aliases server `filesystem` to `project-filesystem`
- **AND** the lockfile format and recorded state satisfy the selected installation mode
- **THEN** another machine SHALL reproduce the effective name without collision prompting

#### Scenario: Alias change moves the effective entry

- **WHEN** a tracked alias changes to a new effective name during a successful non-frozen operation
- **THEN** the old owned entry SHALL be removed and the new entry reconciled transactionally

#### Scenario: Failed install retains stale server intent

- **WHEN** an operation discovers an override for a server no longer declared but later fails
- **THEN** the project manifest SHALL retain the override

#### Scenario: Successful install prunes stale server intent

- **WHEN** a non-frozen operation succeeds after discovering a stale server override
- **THEN** it SHALL report and remove that override in the successful commit

#### Scenario: Normal intent edits are not content mismatches

- **WHEN** a non-frozen operation changes a server alias or omission while reproducing the same verified declaration and facet integrity
- **THEN** it SHALL treat the disposition as project intent rather than an authored-content mismatch
- **AND** a successful commit SHALL record the new disposition without changing the declaration fingerprint

### Requirement: Installation verifies integrity-pinned server declarations before configuration

Concrete declarations SHALL be verified as part of the integrity-protected embedded facet manifest before adapter configuration planning, approval, cleanup, or materialization. Frozen reproduction SHALL derive concrete declarations from the exact integrity-pinned facet content. A lockfile server fingerprint SHALL NOT substitute for verified content or supply a declaration for native rendering. When reproducing `0.4` at unchanged facet integrity, installation SHALL also reconcile the complete recorded server inventory against that content before proceeding.

#### Scenario: Tampered declaration blocks configuration

- **WHEN** resolved facet content changes a declaration without reproducing locked integrity
- **THEN** installation SHALL fail before adapter configuration planning, approval, cleanup, or native MCP writes

#### Scenario: Plausible inventory does not bypass content verification

- **WHEN** a `0.4` lockfile is schema-valid and its server selection has no collision
- **AND** resolved content does not reproduce the locked facet integrity
- **THEN** installation SHALL fail without configuring a server from the recorded metadata

#### Scenario: Locked metadata cannot replace unavailable content

- **WHEN** a `0.4` lockfile records a server-only facet whose content is unavailable both locally and from its source
- **THEN** installation SHALL fail to acquire the verified declaration
- **AND** it SHALL NOT render native configuration from the locked metadata

### Requirement: Frozen installation reconciles MCP configuration without changing shared intent

Frozen installation SHALL derive concrete MCP declarations from exact integrity-pinned facet content. With lockfile `0.4`, it SHALL determine the authored inventory from locked records and compare current manifest server intent with recorded dispositions before fetching content. It SHALL detect stale overrides, conflicting effective identities, and disposition drift using names, fingerprints, and dispositions, including omitted records. Facets with empty inventories SHALL still be checked for stale overrides. Absence of an override SHALL mean authored materialization, not retention of a locked alias. Frozen mode SHALL reject any change to recorded intent even when that change would resolve a collision.

With `0.2` or `0.3`, any server alias or omission in the project manifest SHALL cause a pre-fetch format-capability refusal identifying required version `0.4`. With no server overrides, legacy frozen reproduction SHALL remain supported through verified definitions, subject to existing asset, source, native-state, and approval checks; declaration collisions SHALL still fail before mutation. Legacy inventory SHALL NOT be invented or persisted.

All formats SHALL retain subsequent content verification, supported-adapter checks, native-document validation, and machine-local approval requirements. Frozen installation SHALL NOT write or migrate the project manifest or lockfile and SHALL NOT prompt. Before cleanup or materialization it SHALL fail on unresolved effective-server conflicts, unrepresentable or inconsistent intent, unsupported selected adapters, invalid native configuration, integrity or inventory mismatch, or an unapproved declaration without pre-supplied approval. After every required check passes, it SHALL reconcile native configuration and the machine-local receipt without changing shared state.

#### Scenario: Frozen reproduction configures an approved server

- **WHEN** frozen installation has a covering lockfile, representable matching server intent, verified content, valid native state, and sufficient machine-local approval
- **THEN** it SHALL reconcile the exact locked facet's active declarations
- **AND** it SHALL leave the project manifest and lockfile unchanged

#### Scenario: Frozen reproduction never prompts

- **WHEN** an active declaration lacks machine-local approval during frozen installation
- **THEN** the operation SHALL fail before mutation unless approval was pre-supplied
- **AND** it SHALL NOT open an interactive request

#### Scenario: Frozen server conflict changes nothing

- **WHEN** frozen desired state contains conflicting declarations at one effective name
- **THEN** installation SHALL fail with every claimant identified
- **AND** it SHALL leave project, receipt, asset, and native configuration state unchanged
- **AND** with `0.4` the conflict SHALL be reported before fetching content

#### Scenario: Frozen stale server override is blocking drift

- **WHEN** a server override names no authored record in a `0.4` lockfile's complete inventory
- **THEN** frozen installation SHALL report the stale intent before fetching content
- **AND** it SHALL NOT prune the override or write state

#### Scenario: Frozen cleanup removes a receipt-only server orphan

- **WHEN** the manifest and lockfile no longer desire an effective server still owned by the receipt
- **AND** every frozen consistency check passes
- **THEN** the system SHALL remove the owned native entry and update the receipt
- **AND** it SHALL leave the manifest and lockfile unchanged

#### Scenario: Server override cannot be frozen under legacy formats

- **WHEN** a `0.2` or `0.3` lockfile is used with a server alias or omission
- **AND** preceding coverage and asset checks pass
- **THEN** frozen installation SHALL refuse before facet fetch with the observed format and required version `0.4`
- **AND** it SHALL provide normal-install migration guidance and leave all project and adapter state unchanged

#### Scenario: Legacy server default intent remains reproducible

- **WHEN** a `0.2` or `0.3` lockfile covers a facet declaring servers and the manifest contains no server overrides
- **AND** all other frozen checks pass
- **THEN** installation SHALL verify definitions and reproduce the authored server names
- **AND** it SHALL leave both shared files byte-for-byte unchanged

#### Scenario: Removing an alias is frozen disposition drift

- **WHEN** a `0.4` record aliases `filesystem` to `workspace-files` but the manifest no longer has that override
- **THEN** frozen installation SHALL report authored intent versus the locked alias before fetching
- **AND** it SHALL NOT silently retain the alias or rename the native entry

#### Scenario: Changed omission is frozen disposition drift

- **WHEN** the manifest's omission state differs from the corresponding `0.4` record
- **THEN** frozen installation SHALL fail before fetching content or cleaning owned configuration

#### Scenario: Empty inventory does not hide stale intent

- **WHEN** a `0.4` facet has `servers: []` and the manifest overrides server `gone`
- **THEN** frozen installation SHALL report the absent authored server before fetching content

#### Scenario: Resolving a collision still changes frozen intent

- **WHEN** a hand-merged `0.4` inventory has conflicting recorded claims and a manifest-only alias would separate them
- **THEN** frozen installation SHALL refuse the disposition change before fetching content
- **AND** it SHALL NOT treat the hypothetical collision-free selection as recorded intent

#### Scenario: Locked fingerprint is not approval

- **WHEN** a machine receives a valid `0.4` lockfile with an active server but has no local approval and no pre-supplied approval
- **THEN** frozen installation SHALL still fail for required approval before mutation

#### Scenario: Passing metadata does not bypass inventory reconciliation

- **WHEN** `0.4` pre-fetch checks pass and acquired content reproduces the locked facet integrity
- **AND** a recorded server fingerprint differs from that content's canonical declaration fingerprint
- **THEN** frozen installation SHALL fail with an inventory-reconciliation error before approval, cleanup, or mutation

### Requirement: Removing facets reconciles MCP configuration ownership

Removing a facet SHALL remove an effective MCP entry only when machine-local configuration ownership covers it and no remaining desired or safely carried-forward claim uses the identity. An unowned native entry SHALL never be deleted merely because a facet, alias, or lockfile entry disappeared. A removal that must resolve remaining facets SHALL enter the same MCP approval path as add or install.

Removal-only refinement SHALL carry configuration claims forward without fetching only when complete `0.4` inventories are available for all remaining facets, each active record and receipt claim agree in both directions on authored name, disposition, and fingerprint, and existing evidence anchors those claims to the same facet integrity and current intent. Omitted records SHALL remain locked without requiring claims. Earlier receipts without configuration evidence, legacy remaining lock entries, or any missing or conflicting witness SHALL force ordinary resolution rather than invent ownership. The lockfile SHALL only constrain refinement and SHALL NOT grant deletion or approval authority.

#### Scenario: Last owned claimant removes the server

- **WHEN** a removed facet is the last desired claimant of an owned effective server
- **AND** every remaining facet has a valid `0.4` entry whose source agrees with its manifest entry, whose version satisfies its manifest specifier, and whose asset/server dispositions equal manifest intent
- **AND** a readable receipt records the same facet versions and integrities, matching active asset identities/dispositions/owned file sets, and matching active server names/dispositions/fingerprints
- **AND** the remaining effective set is collision-free and each retained text-asset identity is claimed only by its remaining facet
- **AND** selected adapters load with a supported Adapter SDK API and return successful cleanup plans
- **THEN** the system SHALL remove that server from every selected adapter

#### Scenario: Remaining claimant preserves the server

- **WHEN** another desired facet retains the same effective configuration
- **THEN** a successful removal SHALL preserve the native server entry

#### Scenario: Pre-0.4 receipt forces resolution

- **WHEN** removal would carry a remaining server claim but the loaded receipt predates configuration ownership
- **THEN** the system SHALL perform ordinary resolution rather than treating the lockfile as deletion authority

#### Scenario: Shared matching claims permit offline refinement

- **WHEN** two witnessed facets claim one effective server with equal fingerprints and one facet is removed
- **AND** the remaining facet's `0.4` records, receipt claims, and manifest intent agree
- **THEN** refinement SHALL retain the server without fetching declarations or selecting a winning origin

#### Scenario: Record and claim mismatch prevents refinement

- **WHEN** a remaining active server record lacks a matching receipt claim, a claim lacks a matching active record, or their dispositions or fingerprints differ
- **THEN** removal SHALL require ordinary resolution
- **AND** it SHALL NOT manufacture the missing witness from the lockfile

#### Scenario: Unowned entry is not deleted from lockfile evidence

- **WHEN** an unowned native server corresponds to a locked record of a removed facet
- **THEN** the removal SHALL NOT delete it on the strength of that record or fingerprint

## ADDED Requirements

### Requirement: Installation records complete server inventory from verified definitions

Every newly derived `0.4` server inventory SHALL come from verified facet definitions and the operation's final resolved materialization intent. It SHALL contain all authored servers, including omitted declarations, and SHALL use each declaration's canonical semantic fingerprint. Each resolved facet SHALL receive a server array, including an explicit empty array when none are declared. Active composition SHALL NOT erase the separate records of identical contributors or omitted origins. Adapters, native configuration, receipts, and legacy extension fields SHALL NOT supply new canonical authored inventory.

The inventory SHALL be committed with the project manifest, lockfile, receipt, assets, and native configuration under the existing transactional guarantees. A failed operation SHALL NOT publish new inventory. Successful frozen reproduction SHALL report the retained lockfile rather than claim a new-format file was written. Persisted server records SHALL NOT grant approval, ownership, deletion, or takeover authority, and generated records SHALL NOT copy declaration values or tool-specific encodings.

#### Scenario: Server-only install records inventory without text assets

- **WHEN** a server-only facet installs successfully
- **THEN** its `0.4` entry SHALL contain an empty assets array and its complete authored server records

#### Scenario: Identical composition does not collapse per-facet records

- **WHEN** two facets contribute identical declarations at one selected effective identity
- **THEN** each facet SHALL retain its own authored server record under its own source, version, and integrity
- **AND** only native selection SHALL compose those claims into one configuration

#### Scenario: Omitted definitions remain verifiable

- **WHEN** installation omits an authored server through project intent
- **THEN** its record SHALL still contain the fingerprint computed from its verified definition
- **AND** that record SHALL NOT become an approval or materialized-ownership claim

#### Scenario: Facet with no servers has a verified empty list

- **WHEN** verified content declares no MCP servers
- **THEN** the generated facet entry SHALL contain `servers: []`
- **AND** a receipt's silence alone SHALL NOT be sufficient evidence to generate that list

#### Scenario: Commit failure restores prior inventory

- **WHEN** an operation changes assets or native configuration but fails while committing the new inventory and project state
- **THEN** it SHALL restore the previous project files and affected materializations under the existing restoration rules
- **AND** no new ownership or approval evidence SHALL survive the failed operation

#### Scenario: Frozen legacy success does not claim migration

- **WHEN** a legacy frozen reproduction succeeds using verified definitions
- **THEN** its reported lockfile SHALL remain the original legacy document
- **AND** it SHALL NOT report a persisted `0.4` server inventory

#### Scenario: Written inventory is byte-deterministic

- **WHEN** two successful writes produce the same resolved facets, authored asset/server records, and dispositions from identical retained extension data
- **AND** only facet or server processing order differs
- **THEN** their `0.4` lockfiles SHALL be byte-identical
- **AND** facets and server records SHALL use their specified deterministic ordering, two-space JSON indentation, and exactly one trailing newline

#### Scenario: Locked record does not authorize native takeover

- **WHEN** an active locked server's effective name is occupied by an unowned native entry
- **AND** takeover approval has not been explicitly supplied
- **THEN** installation SHALL require approval before adopting or replacing that entry
- **AND** this SHALL hold even when the native entry matches the desired declaration

### Requirement: Reproduced server inventory agrees with verified authored content

When an operation resolves a facet to the same integrity as its previous `0.4` entry, the system SHALL compare the complete locked authored server-name set and every locked fingerprint with the verified definitions. This comparison SHALL include omitted servers and SHALL run regardless of source kind, cache warmth, or frozen versus non-frozen mode. Missing, unexpected, or mismatched records SHALL fail before collision prompting, adapter configuration planning, approval, cleanup, or materialization, rather than being silently regenerated.

The failure SHALL distinguish authored-name set differences from fingerprint differences and identify the facet. Set differences SHALL report sorted names, with missing meaning locked but absent from verified content and unexpected meaning verified but absent from the lockfile. Fingerprint mismatches SHALL identify the authored server and expected locked and observed verified fingerprints. Dispositions SHALL NOT be compared as content: normal intent changes remain permitted while frozen and removal rules separately constrain intent. A valid update to different facet integrity SHALL derive a fresh inventory only after ordinary integrity checks pass. Legacy records SHALL NOT be treated as a complete inventory to reconcile.

#### Scenario: A locked name absent from content is rejected

- **WHEN** an unchanged-integrity `0.4` entry records server `gone` but the verified definitions do not
- **THEN** the operation SHALL fail with `gone` in the missing-name data before any approval, cleanup, or write

#### Scenario: An unrecorded verified server is rejected

- **WHEN** verified content at unchanged facet integrity declares `extra` but the previous `0.4` inventory does not
- **THEN** the operation SHALL fail with `extra` in the unexpected-name data
- **AND** it SHALL NOT silently append the missing record

#### Scenario: Changed fingerprint is not silently repaired

- **WHEN** an unchanged-integrity record's fingerprint differs from the canonical fingerprint of its verified declaration
- **THEN** the operation SHALL report the facet, authored server, expected fingerprint, and observed fingerprint
- **AND** it SHALL leave project and adapter state unchanged

#### Scenario: Omitted fingerprint mismatch still fails

- **WHEN** a mismatched record is marked omitted
- **THEN** the operation SHALL reject it exactly as it would an active record

#### Scenario: Cache warmth does not weaken reconciliation

- **WHEN** the same inconsistent `0.4` inventory is reproduced from a verified warm cache and from newly acquired verified content
- **THEN** both operations SHALL report the same inventory discrepancy before configuration planning or mutation

#### Scenario: Legitimate update creates a new inventory

- **WHEN** a valid source update resolves to different verified facet integrity and changes the authored server set
- **THEN** the operation SHALL derive the new complete inventory after verification
- **AND** it SHALL NOT treat the old set as a same-integrity inventory mismatch

#### Scenario: Legacy lookalike is not a reconciliation baseline

- **WHEN** the previous document is `0.2` or `0.3` and has a `servers` extension with incorrect apparent fingerprints
- **THEN** those values SHALL NOT be treated as locked server records
- **AND** a successful non-frozen operation SHALL replace them with metadata from verified definitions

### Requirement: Server inventory diagnostics explain mismatches without declaration disclosure

Inventory failures SHALL provide structured facet, authored/effective identity, disposition, version, and fingerprint fields as applicable. Pre-fetch collision reports SHALL retain every conflicting claimant and SHALL NOT fetch declaration content solely to enrich diagnostics. Inventory and frozen-drift diagnostics SHALL NOT reproduce commands, URLs, arguments, or environment values; existing explicit approval surfaces remain unchanged.

Recovery guidance SHALL distinguish format migration, deliberate intent changes, same-integrity inventory corruption, and approval requirements. It SHALL NOT claim that an ordinary install silently repairs a same-integrity mismatch. When legacy removal falls back to resolution and that resolution fails, diagnostic data SHALL retain both the migration context and the actual acquisition or integrity cause. Guidance SHALL distinguish capability versions from the current writer version.

Public guidance SHALL explain that comparing independently computed export fingerprints with inventory proves agreement with a trusted lockfile, not lockfile authenticity, archive membership, successful native installation, or machine-local consent. It SHALL also explain that fingerprints are not encryption: low-entropy literal values can be guessed when the rest of a declaration is known, including for local-source facets. Literal-string validation SHALL NOT be represented as secret detection.

#### Scenario: Pre-fetch conflict report does not need declarations

- **WHEN** a `0.4` frozen check finds unequal fingerprints at one effective identity
- **THEN** it SHALL report the identity and all claimant facets, authored names, and fingerprints without fetching facet content
- **AND** the report SHALL contain no generated declaration values

#### Scenario: Corruption guidance does not promise silent repair

- **WHEN** same-integrity server metadata disagrees with verified definitions
- **THEN** guidance SHALL direct the user to review or restore inconsistent locked state
- **AND** it SHALL NOT describe a plain retry as a way to overwrite the mismatch silently

#### Scenario: Migration fallback retains its actual failure cause

- **WHEN** legacy removal requires remaining content and acquiring it fails
- **THEN** the failure SHALL identify why verified migration was needed and retain the underlying acquisition failure as structured data
- **AND** the guidance SHALL NOT replace that cause with a generic migration-only message

#### Scenario: Fingerprint-only storage is not a secrecy promise

- **WHEN** a user consults the locked-inventory documentation for a local facet with literal environment values
- **THEN** it SHALL explain the possibility of offline guessing and advise against including secrets in declarations
- **AND** it SHALL NOT suggest that values are omitted, redacted, or source-salted during fingerprinting
