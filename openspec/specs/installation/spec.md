## Purpose

The lockfile (`facets.lock`) records the exact resolved state of installed facets so that installations are reproducible across machines and environments. This spec defines what a valid lockfile contains.

The closed-alpha lockfile shape is **adapter-agnostic**: it records what each facet contributes (scope/type/name tuples) and leaves materialization to the installer. The installer applies the same asset set to every selected adapter, so the lockfile never embeds per-adapter state.
## Requirements
### Requirement: Lockfile declares a version

The lockfile SHALL declare `lockfileVersion`. Current lockfiles SHALL use numeric `0.3`. Version selection SHALL use exact equality rather than numeric ordering: numeric `0.2` SHALL identify only the preceding schema, and numeric `0.3` SHALL identify only the current schema. Shape inference and cross-version fallback SHALL NOT occur. Missing or unsupported versions SHALL produce structured rejection data.

Numeric `1` SHALL NOT be readable. It named a withdrawn closed-alpha shape and is reserved for a future stable v1, so a lockfile declaring it SHALL be rejected as an unsupported version, and the rejection SHALL offer actionable delete-and-regenerate guidance rather than reinterpreting the document from its remaining shape.

Every successful non-frozen install SHALL write `0.3`, including when no materialization overrides exist. A verified `0.2` lockfile SHALL be migrated only after every resolved artifact satisfies every current integrity check, with each earlier asset refined to authored materialization. A removal-only operation SHALL be exempt from that verification precondition, because it refines remaining entries structurally without fetching or reverifying them. Removing all overrides SHALL NOT downgrade the lockfile. Frozen installation SHALL NOT rewrite a `0.2` lockfile and SHALL fail if that schema cannot represent the project manifest's materialization intent.

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

#### Scenario: Withdrawn alpha version is rejected with recovery guidance

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** the system SHALL reject it as an unsupported version
- **AND** it SHALL NOT infer a schema from the remaining shape
- **AND** the failure SHALL tell the user to delete the lockfile and regenerate it with a normal install

#### Scenario: Unsupported lockfile version is rejected

- **WHEN** a lockfile declares an unsupported version
- **THEN** the system SHALL reject it with structured observed and supported versions

#### Scenario: Normal install migrates verified earlier state

- **WHEN** a non-frozen install loads a valid `0.2` lockfile and verifies every resolved artifact
- **THEN** it SHALL write equivalent `0.3` state after successful installation

#### Scenario: Resolution-free project still migrates

- **WHEN** a non-frozen install succeeds without any override
- **THEN** the committed lockfile SHALL declare `0.3`

#### Scenario: Frozen install does not migrate

- **WHEN** frozen installation uses a `0.2` lockfile whose consistency check passes
- **THEN** it SHALL NOT rewrite the lockfile

#### Scenario: Frozen install fails when resolutions require the current format

- **WHEN** frozen installation uses a `0.2` lockfile
- **AND** the project manifest records materialization intent that format cannot represent
- **THEN** the operation SHALL fail without rewriting any state

#### Scenario: Frozen install rejects a withdrawn alpha lockfile

- **WHEN** frozen installation encounters a lockfile declaring numeric `lockfileVersion: 1`
- **THEN** it SHALL fail on the unsupported version without rewriting any state

### Requirement: Each facet entry records source provenance

For every facet in `facets`, the lockfile SHALL record the facet's source provenance using a tagged shape whose form depends on the source kind. Each entry's source SHALL declare its kind and carry only the provenance fields meaningful for that kind:

- A **registry** source SHALL record the registry origin (the base URL the artifact was resolved from). A registry source SHALL NOT carry a version specifier; the entry's `version` field is the resolved identity and the facet name is the entry key.
- A **git** source SHALL record the repository URL and the resolved commit SHA. The commit SHALL be required, because it is the immutable identity that makes the install reproducible. A git source SHALL NOT record the symbolic ref: the ref is what the user requested and is recorded in the project manifest, whereas the lockfile records what was resolved.
- A **local** source SHALL record the resolved path.

Source-provenance fields SHALL live inside the source value (there are no top-level ref or commit fields; the git commit lives inside the git source). A lockfile entry whose source does not declare a recognized kind, or whose source omits a field required for its declared kind (such as a git source without a commit), SHALL be rejected. Consistent with the lockfile's general unknown-field tolerance, a source MAY carry additional unrecognized keys without being rejected — only a missing or malformed required field fails validation.

#### Scenario: Valid registry-source entry

- **WHEN** a lockfile facet entry declares a registry source recording the registry base URL, together with `version`, `integrity`, and `assets`
- **THEN** the system SHALL accept the entry

#### Scenario: Registry-source entry never carries a version specifier

- **WHEN** the system writes a lockfile entry for a registry-sourced facet
- **THEN** the recorded source SHALL NOT contain a version specifier of any form (an exact version, a wildcard such as `1.*` or `*`, or the `latest` tag)
- **AND** the resolved version SHALL be recorded only in the entry's `version` field

#### Scenario: Valid git-source entry

- **WHEN** a lockfile facet entry declares a git source recording the repository URL and the resolved commit SHA, together with `version`, `integrity`, and `assets`
- **THEN** the system SHALL accept the entry

#### Scenario: Git-source entry without a commit is rejected

- **WHEN** a lockfile facet entry declares a git source that records a repository URL but no resolved commit
- **THEN** the system SHALL reject the entry

#### Scenario: Valid local-source entry

- **WHEN** a lockfile facet entry declares a local source recording the resolved path, together with `version`, `integrity`, and `assets`
- **THEN** the system SHALL accept the entry

### Requirement: Each facet entry captures identity and integrity

Every facet entry SHALL include `version` (from the facet's `facet.json`) and `integrity` (the sha256 of the built `.facet` archive). Missing either field SHALL cause the lockfile to be rejected.

#### Scenario: Missing integrity hash

- **WHEN** a facet entry omits `integrity`
- **THEN** the system SHALL reject the lockfile

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every current facet entry SHALL include an `assets` array. Each member SHALL record authored `scope`, `type`, and `name`, a required materialization disposition, and a required `files` array sorted deterministically by canonical authored path. `scope` SHALL be `system`, `user`, or `project`; `type` SHALL be `skill`, `agent`, or `command`. Each file record SHALL contain canonical inner-archive `path` and `sha256:<hex>` `integrity` over canonical archive bytes. The lockfile SHALL contain no adapter-specific fields, hashes, or dispositions.

The disposition SHALL state authored, aliased with a valid effective name, or omitted. Omitted assets SHALL remain listed with every authored file record. A skill's file records SHALL include `skills/<name>/SKILL.md` and every declared companion. An agent or command SHALL contain exactly its conventional primary file record. Skill companions SHALL remain subordinate to their owning skill, follow its disposition, and SHALL NOT become independent assets or receive their own scopes. Archive-only supplementary files SHALL NOT appear in an asset's files.

Every file record SHALL be derived from its own asset's authored type and name, not merely be a safe, sorted, non-duplicate path. An agent or command entry SHALL contain exactly one record at its canonical primary path; every record in a skill entry SHALL lie beneath that skill's authored root and SHALL include its canonical primary file. A record that no derivation from the owning asset's authored identity could produce SHALL be rejected, so ownership and integrity are never associated with an unrelated archive file. These rules SHALL apply to both `0.2` and `0.3` entries.

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

#### Scenario: File record unrelated to its asset is rejected

- **WHEN** a command entry records a safe, sorted file record whose path is not that command's canonical primary path
- **THEN** the system SHALL reject the lockfile
- **AND** the rejection SHALL apply equally to a `0.2` and a `0.3` entry

#### Scenario: Unknown asset scope

- **WHEN** an asset scope is `global`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Unknown asset type

- **WHEN** an asset type is `hook`
- **THEN** the system SHALL reject the lockfile

### Requirement: A lockfile without facets is valid

A project that declares no facets in `facets.json` SHALL produce a valid lockfile with an empty `facets` object.

#### Scenario: Empty facets map

- **WHEN** a lockfile contains `lockfileVersion` and `facets: {}`
- **THEN** the system SHALL accept the lockfile

### Requirement: Unrecognized fields are tolerated

The system SHALL accept lockfiles containing fields not defined in the current schema. Unrecognized fields SHALL be preserved, not stripped or rejected.

Preservation SHALL survive reconstruction, not only loading. When the system rewrites a lockfile, it SHALL carry forward the unrecognized fields of the top-level document, of every facet entry it still records, of a retained facet's source when the source kind is unchanged, of every asset entry matched by authored scope, type, and name, and of every file record matched by path. Where a schema-defined field and an unrecognized field share a name, the schema-defined value SHALL win. Unrecognized fields belonging to a facet, asset, or file record the new state no longer contains SHALL be dropped with it.

#### Scenario: Unknown field in lockfile

- **WHEN** a lockfile contains a field not defined in the schema (e.g., `generatedAt: "2026-04-18"`)
- **THEN** the system SHALL accept the lockfile
- **AND** the field SHALL be present in the loaded result

#### Scenario: Unknown fields survive migration to the current version

- **WHEN** a non-frozen install migrates a `0.2` lockfile carrying unrecognized fields at the document, facet, source, asset, and file-record levels
- **THEN** the committed `0.3` lockfile SHALL still contain every one of those fields
- **AND** the same preservation SHALL hold when the loaded lockfile is already `0.3`

#### Scenario: Removed state takes its unknown fields with it

- **WHEN** a rewrite no longer records a facet that carried an unrecognized field
- **THEN** that field SHALL NOT appear in the rewritten lockfile

### Requirement: Adding a facet installs it

When a user adds a facet to a project, the system SHALL fetch its content, verify its integrity, materialize its assets into every selected adapter, and update the lockfile in a single operation. A user SHALL NOT need to run a separate install step after adding. Registry-sourced facets SHALL support unscoped names and scoped names.

#### Scenario: Adding a registry facet installs it

- **WHEN** a user adds a registry facet to a project that has at least one selected adapter
- **THEN** the system SHALL update the project manifest to reference the facet
- **AND** the system SHALL fetch the facet's content
- **AND** the system SHALL verify the facet's integrity before any assets are written
- **AND** the system SHALL materialize the facet's assets into every selected adapter
- **AND** the system SHALL update the lockfile to record the resolved version, integrity hash, and asset list
- **AND** the operation SHALL complete in a single command invocation

#### Scenario: Adding a scoped registry facet installs it

- **WHEN** a user adds `@julian/cowsay` to a project that has at least one selected adapter
- **THEN** the system SHALL treat `@julian/cowsay` as a registry facet source
- **AND** the system SHALL fetch, verify, materialize, and lock the scoped facet in a single command invocation

#### Scenario: Adding a git facet installs it

- **WHEN** a user adds a git-source facet to a project that has at least one selected adapter
- **THEN** the system SHALL resolve the symbolic ref to a commit
- **AND** the system SHALL fetch the facet's content
- **AND** the system SHALL build the facet locally
- **AND** the system SHALL verify the facet's integrity before any assets are written
- **AND** the system SHALL materialize the facet's assets into every selected adapter
- **AND** the system SHALL update the lockfile to record the resolved commit, integrity hash, and asset list

#### Scenario: Adding a local facet installs it

- **WHEN** a user adds a local-path facet to a project that has at least one selected adapter
- **THEN** the system SHALL build the facet from the local path
- **AND** the system SHALL materialize the facet's assets into every selected adapter
- **AND** the system SHALL update the lockfile to record the version, integrity hash, and asset list

#### Scenario: Re-adding a facet at a different version

- **WHEN** a user adds a facet that is already declared in the project manifest
- **AND** the new specifier resolves to a different version than the current one
- **THEN** the system SHALL update the manifest entry to the new specifier
- **AND** the system SHALL replace the previous version in the lockfile and materialized assets
- **AND** the user-visible summary SHALL indicate that the facet was updated from the previous version to the new one

#### Scenario: Re-adding the same facet at the same version

- **WHEN** a user adds a facet that is already declared at the same resolved version
- **THEN** the system SHALL leave the manifest unchanged
- **AND** the system SHALL re-verify integrity and re-materialize assets to repair any drift
- **AND** the operation SHALL succeed without error

### Requirement: Adding a facet without a selected adapter prompts the user

When a user adds a facet to a project that has no selected adapter, the system SHALL guide the user through selecting one before installing. In a non-interactive environment, the system SHALL fail with a clear error.

#### Scenario: Interactive terminal triggers adapter selection

- **WHEN** a user adds a facet in an interactive terminal session
- **AND** the project has no selected adapter
- **THEN** the system SHALL prompt the user to select one or more adapters
- **AND** if the user selects at least one adapter, the system SHALL proceed with installation
- **AND** if the user cancels selection, the system SHALL leave the project manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Non-interactive environment fails fast

- **WHEN** a user adds a facet in a non-interactive environment
- **AND** the project has no selected adapter
- **THEN** the system SHALL exit with a non-zero status without modifying the project
- **AND** the error SHALL direct the user to run interactive adapter selection

### Requirement: Specifier syntax is restricted to four version forms

When a user specifies a version, the system SHALL accept only one of five forms: an exact version, a major-pinned wildcard, a minor-pinned wildcard, a bare wildcard, or the literal tag `latest`. Any other range syntax SHALL be rejected with a clear error pointing the user at the supported form.

#### Scenario: Exact version is accepted

- **WHEN** a user specifies a facet with a version of the form `MAJOR.MINOR.PATCH` (e.g., `1.2.3`)
- **THEN** the system SHALL accept the version

#### Scenario: Major-wildcard is accepted

- **WHEN** a user specifies a facet with a version of the form `MAJOR.*` (e.g., `1.*`)
- **THEN** the system SHALL accept the version
- **AND** the system SHALL resolve to the highest published version sharing that major

#### Scenario: Minor-wildcard is accepted

- **WHEN** a user specifies a facet with a version of the form `MAJOR.MINOR.*` (e.g., `1.2.*`)
- **THEN** the system SHALL accept the version
- **AND** the system SHALL resolve to the highest published patch sharing that major.minor

#### Scenario: Bare wildcard is accepted

- **WHEN** a user specifies a facet with a version of `*`
- **THEN** the system SHALL accept the version
- **AND** the system SHALL resolve to the highest published version

#### Scenario: Latest tag is accepted

- **WHEN** a user specifies a facet with a version of `latest`
- **THEN** the system SHALL accept the version
- **AND** the system SHALL resolve to the highest published version

#### Scenario: Caret range is rejected

- **WHEN** a user specifies a facet with a version using `^` (e.g., `^1.2.3`)
- **THEN** the system SHALL reject the specifier with an error
- **AND** the error SHALL direct the user at the supported wildcard form

#### Scenario: Tilde range is rejected

- **WHEN** a user specifies a facet with a version using `~` (e.g., `~1.2.3`)
- **THEN** the system SHALL reject the specifier with an error
- **AND** the error SHALL direct the user at the supported wildcard form

#### Scenario: Other range operators are rejected

- **WHEN** a user specifies a facet with a version using `>=`, `<`, `||`, hyphen ranges, or `x`-style placeholders (e.g., `1.x`)
- **THEN** the system SHALL reject the specifier with an error

### Requirement: Adding a facet without a version stores the resolved version pinned

When a user adds a registry facet without specifying a version, the system SHALL resolve the latest published version and SHALL record a version specifier in the project manifest. The system SHALL NOT record the facet name in the version position. A bare name and the literal tag `@latest` SHALL be equivalent and SHALL produce identical results. The user SHALL NOT need to specify a version explicitly to get reproducible builds.

When no manifest entry for the facet exists, or the existing entry's value is not a valid version specifier, the system SHALL record the resolved exact version (`name@MAJOR.MINOR.PATCH` for unscoped names, `@scope/name@MAJOR.MINOR.PATCH` for scoped names). When a manifest entry already exists and its value is a valid version specifier, the system SHALL preserve that value unchanged, so that a re-add without a version does not overwrite a version the user previously chose.

#### Scenario: Bare facet name is recorded as exact version

- **WHEN** a user adds a registry facet using only its name (no version)
- **AND** no entry for that facet exists in the project manifest
- **THEN** the system SHALL resolve the latest published version
- **AND** the system SHALL record `name@MAJOR.MINOR.PATCH` in the project manifest
- **AND** the system SHALL NOT record the facet name as the version value

#### Scenario: Scoped bare facet name is recorded as exact version

- **WHEN** a user adds `@julian/cowsay` with no version
- **AND** no entry for that facet exists in the project manifest
- **THEN** the system SHALL resolve the latest published version
- **AND** the system SHALL record `@julian/cowsay@MAJOR.MINOR.PATCH` in the project manifest

#### Scenario: Explicit @latest tag records "latest" in the manifest

- **WHEN** a user adds a registry facet using the literal `name@latest` form
- **THEN** the system SHALL resolve the latest published version
- **AND** the system SHALL record `latest` as the version specifier in the project manifest (preserving the user's explicit intent to float)
- **AND** the system SHALL record the resolved exact version in the lockfile

#### Scenario: Explicit @latest tag on a scoped name records "latest" in the manifest

- **WHEN** a user adds a registry facet using the literal `@scope/name@latest` form
- **THEN** the system SHALL resolve the latest published version for `@scope/name`
- **AND** the system SHALL record `latest` as the version specifier in the project manifest
- **AND** the system SHALL record the resolved exact version in the lockfile

> **Note:** This differs from the bare-name form, which pins to the resolved exact version. A bare name is shorthand for "give me the latest and pin it"; `name@latest` is an explicit floating specifier, analogous to `name@1.*`.

#### Scenario: Wildcard-resolved version is recorded as exact version

- **WHEN** a user adds a registry facet using a wildcard form (e.g., `name@1.*`)
- **THEN** the system SHALL record the wildcard as written in the project manifest
- **AND** the system SHALL record the resolved exact version in the lockfile

#### Scenario: Re-adding without a version preserves an existing valid version

- **WHEN** the project manifest already records a facet with a valid version specifier (e.g., `1.*`, `1.2.*`, `1.2.3`, `*`, or `latest`)
- **AND** a user re-adds that facet without specifying a version
- **THEN** the system SHALL preserve the existing version specifier in the project manifest unchanged
- **AND** the system SHALL NOT overwrite it with the resolved exact version

#### Scenario: Re-adding without a version heals an invalid recorded value

- **WHEN** the project manifest records a facet whose value is not a valid version specifier (e.g., the facet name appears in the version position)
- **AND** a user re-adds that facet without specifying a version
- **THEN** the system SHALL resolve the latest published version
- **AND** the system SHALL replace the invalid value with the resolved exact version (`name@MAJOR.MINOR.PATCH` or `@scope/name@MAJOR.MINOR.PATCH`) in the project manifest

#### Scenario: Adding a git or local facet records the full source specifier

- **WHEN** a user adds a facet from a git source or a local path
- **THEN** the system SHALL record the full source specifier (the git URL with any ref, or the local path) as the manifest value
- **AND** the system SHALL NOT replace it with a version specifier

### Requirement: Source specifier syntax matches established package-manager conventions

When a user specifies a facet source, the system SHALL accept the same set of forms users expect from established package managers, and SHALL reject obsolete or deprecated prefixes with a clear migration message. Registry sources SHALL accept unscoped names (`name` and `name@version`) and scoped names (`@scope/name` and `@scope/name@version`). In a scoped registry source, the leading `@` SHALL identify the scope and the version separator SHALL be the `@` after the name segment.

#### Scenario: Registry name is accepted

- **WHEN** a user specifies a source of the form `name` or `name@version`
- **THEN** the system SHALL treat it as a registry source

#### Scenario: Scoped registry name is accepted

- **WHEN** a user specifies a source of the form `@scope/name` or `@scope/name@version`
- **THEN** the system SHALL treat it as a registry source
- **AND** the system SHALL parse the name as `@scope/name`

#### Scenario: Scoped registry name with latest is accepted

- **WHEN** a user specifies `@scope/name@latest`
- **THEN** the system SHALL treat it as a registry source for `@scope/name`
- **AND** the system SHALL parse the version specifier as `latest`

#### Scenario: Malformed scoped registry name is rejected

- **WHEN** a user specifies `@scope`, `@scope/`, `@scope/name@`, or `@scope/name@^1.0.0`
- **THEN** the system SHALL reject the source specifier with an actionable error

#### Scenario: GitHub shorthand is accepted

- **WHEN** a user specifies a source of the form `github:owner/repo` (optionally with `#ref`)
- **THEN** the system SHALL treat it as a git source on GitHub

#### Scenario: SCP-style git URL is accepted

- **WHEN** a user specifies a source of the form `git@host:owner/repo` (optionally with `#ref`)
- **THEN** the system SHALL treat it as a git source

#### Scenario: HTTPS URL ending in .git is accepted

- **WHEN** a user specifies a source whose scheme is `https` and whose path ends in `.git`
- **THEN** the system SHALL treat it as a git source

#### Scenario: Local path is accepted

- **WHEN** a user specifies a source that begins with `.`, `~/`, `/`, `\`, or a Windows drive letter
- **THEN** the system SHALL treat it as a local source

#### Scenario: Deprecated git+ prefix is rejected

- **WHEN** a user specifies a source beginning with `git+`
- **THEN** the system SHALL reject the source with an error
- **AND** the error SHALL show the user the equivalent unprefixed form (e.g., suggesting `https://...` or `git@...:...`)

#### Scenario: Redundant file: prefix is tolerated

- **WHEN** a user specifies a source beginning with `file:`
- **THEN** the system SHALL strip the prefix and treat the remaining path as a local source

### Requirement: Version resolution, content download, and integrity confirmation are distinct network operations

The system performs three distinct network operations when installing a registry facet, and SHALL gate them independently:

- **Version resolution** — determining the exact version a specifier refers to (turning a bare name, `latest`, `*`, or a bounded wildcard such as `1.*` into a concrete `MAJOR.MINOR.PATCH`). The system SHALL perform version resolution only when an exact version is not already known.
- **Content download** — retrieving the archive bytes for an exact `name@version`. The system SHALL perform content download only when that exact version is not already present in the local cache.
- **Integrity confirmation** — verifying that the content about to be installed matches the integrity the registry publishes for that exact `name@version`. The system SHALL perform integrity confirmation whenever it records a lockfile entry for a registry facet that no existing satisfying lockfile entry already anchors, and SHALL NOT record such an entry without it. A satisfying lockfile entry SHALL serve as the trust anchor instead, requiring no confirmation.

An exact version that is already cached SHALL require neither version resolution nor content download. A request whose exact version is already known (an exact specifier, or a satisfying lockfile entry) SHALL NOT trigger version resolution. The presence of a cached copy SHALL NOT, by itself, avoid version resolution when the exact version is not yet known, and SHALL NOT avoid integrity confirmation when a lockfile entry is being created.

#### Scenario: Exact specifier with warm cache and satisfying lockfile entry requires no network access

- **WHEN** a user adds a facet by an exact version whose content is already in the cache
- **AND** the lockfile already records that exact version with its integrity
- **THEN** the system SHALL NOT perform version resolution
- **AND** the system SHALL NOT perform a content download
- **AND** the system SHALL NOT perform integrity confirmation
- **AND** the install SHALL succeed using the cached content, verified against the lockfile's recorded integrity

#### Scenario: Exact specifier with warm cache but no lockfile entry confirms integrity before locking

- **WHEN** a user adds a facet by an exact version whose content is already in the cache
- **AND** the project has no satisfying lockfile entry for that facet
- **THEN** the system SHALL NOT perform version resolution
- **AND** the system SHALL NOT perform a content download
- **AND** the system SHALL confirm the cached content's integrity against the integrity the registry publishes for that exact version before recording the lockfile entry

#### Scenario: A lockfile entry is never created without registry confirmation

- **WHEN** the system would record a lockfile entry for a registry facet that no existing satisfying lockfile entry anchors
- **AND** the registry is unreachable
- **THEN** the system SHALL fail the operation
- **AND** the system SHALL NOT write a lockfile entry for that facet
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Known exact version with cold cache downloads but does not re-resolve

- **WHEN** the system installs a facet whose exact version is already known but whose content is not in the cache
- **THEN** the system SHALL download the content for that exact version
- **AND** the system SHALL NOT perform version resolution

#### Scenario: Unknown exact version resolves before downloading

- **WHEN** the system installs a facet whose exact version is not yet known (a bare name, `latest`, `*`, or a wildcard with no satisfying recorded version)
- **THEN** the system SHALL perform version resolution to determine the exact version
- **AND** the system SHALL then use the cache for that exact version, downloading only on a miss

### Requirement: An explicit add request is resolved fresh, independent of the lockfile

When a user explicitly adds a facet, the system SHALL treat that request as authoritative and SHALL NOT consult the lockfile for version resolution. The system MAY still use a satisfying lockfile entry's recorded integrity as a trust anchor (see the offline re-add scenario below). The system SHALL distinguish a facet the user is **explicitly adding** from a facet **already recorded in the manifest** that is merely being reproduced, and SHALL trust the lockfile only for the latter.

For an explicit add:

- An **exact** version requires no version resolution; the system SHALL use it directly (cache-first).
- Any **non-exact** specifier (a bare name, `latest`, `*`, or a bounded wildcard) SHALL trigger version resolution against the registry to the newest matching version, **even when the lockfile already records a version that would satisfy the specifier**. The user is requesting the newest matching version, not reproduction of a prior resolution.

#### Scenario: Adding an exact version uses the cache and skips the content download

- **WHEN** a user adds a facet by an exact version whose content is already cached
- **AND** the project has no lockfile entry for that facet
- **THEN** the system SHALL install the facet from the cached content without downloading it
- **AND** the system SHALL confirm the content's integrity against the integrity the registry publishes for that exact version
- **AND** the system SHALL record the version and the confirmed integrity in the lockfile

#### Scenario: Re-adding a version the lockfile already records succeeds offline

- **WHEN** a user adds a facet by an exact version whose content is already cached
- **AND** the lockfile already records that exact version with its integrity
- **AND** the registry is unreachable
- **THEN** the system SHALL verify the cached content against the lockfile's recorded integrity
- **AND** the install SHALL succeed without contacting the network

#### Scenario: Adding a wildcard re-resolves even when the lockfile satisfies it

- **WHEN** a user adds a facet by a bounded wildcard (e.g., `0.*`)
- **AND** the lockfile already records a version that satisfies `0.*` (e.g., `0.3.1`)
- **AND** a newer in-range version exists (e.g., `0.9.0`)
- **THEN** the system SHALL resolve the wildcard to the newest in-range version (`0.9.0`)
- **AND** the system SHALL NOT install the older locked `0.3.1` in satisfaction of the add request

#### Scenario: Adding latest re-resolves even when the lockfile records a version

- **WHEN** a user adds a facet by a bare name or `latest`
- **AND** the lockfile already records a version for that facet
- **THEN** the system SHALL resolve the newest published version over the network
- **AND** the system SHALL NOT reuse the locked version in satisfaction of the add request

### Requirement: A machine-local record tracks what each project has materialized

The system SHALL maintain a machine-local receipt describing the asset and file ownership successfully materialized for each project. The receipt SHALL be separate from version-controlled state, identified by canonical project location, and sufficient for offline rollback and removal without cache or network access. Each canonical project location SHALL have its own receipt; two projects SHALL never share one, and concurrent operations in different projects SHALL NOT contend on the same receipt. The receipt SHALL survive lockfile changes made outside the system. Current receipts SHALL use schema version `0.3` and record only assets actually materialized, with authored identity, authored owned-file paths, and the authored-or-aliased materialization disposition needed to address the effective adapter identity, without storing adapter-encoded hashes. Omitted assets SHALL NOT appear. Receipt `1` and `0.2` assets SHALL refine losslessly to authored materialization. A legacy receipt that predates companion ownership MAY be refined to primary-only ownership because legacy installation could not materialize companions.

The receipt SHALL be the sole authority for materialized ownership. A receipt that cannot be loaded — absent, corrupt, or path-mismatched — SHALL confer no ownership, and the system SHALL NOT derive ownership from the lockfile in its place, because the lockfile is shared, version-controlled state that describes intended rather than local materialization. A corrupt or path-mismatched receipt SHALL be reported, because it silently withdraws deletion authority the project previously had; an absent receipt SHALL NOT be, being the ordinary first-operation state. An asset the receipt records SHALL be a **tracked materialization**; an asset on disk that no receipt record covers SHALL be an **untracked materialization**. Desired project state SHALL authorize writes and tracked ownership SHALL authorize deletion: the system SHALL write every desired effective adapter identity, overwriting an untracked file already occupying one and recording it as tracked thereafter, and SHALL leave untracked files at identities the desired state does not name untouched.

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
- **AND** the receipt records its materialization
- **THEN** the system SHALL remove recorded files using the receipt

#### Scenario: Project without a receipt owns nothing yet

- **WHEN** a project has a lockfile but no receipt
- **THEN** the next operation SHALL treat every materialization as untracked
- **AND** it SHALL NOT delete any file on the strength of a lockfile entry alone
- **AND** it SHALL record ownership only for the identities it writes

#### Scenario: Omitted asset is excluded from receipt

- **WHEN** a lockfile asset is omitted
- **THEN** the system SHALL NOT record it as materialized

#### Scenario: Untracked file at a desired identity is overwritten and then tracked

- **WHEN** an untracked file already occupies an effective adapter identity the desired state names
- **THEN** installation SHALL write the desired content to that identity
- **AND** the committed receipt SHALL record that identity as tracked

#### Scenario: Untracked file outside the desired state is left alone

- **WHEN** an untracked file occupies an effective adapter identity no desired asset names and no receipt record covers
- **THEN** the system SHALL NOT address or delete it

#### Scenario: Earlier receipts refine directly to current state

- **WHEN** the system loads receipt version `1` or `0.2`
- **THEN** it SHALL refine each asset to authored materialization in the in-memory current `0.3` receipt shape
- **AND** version `1` SHALL refine to primary-only ownership while `0.2` SHALL retain its complete owned-path set
- **AND** the next successful receipt write SHALL emit `0.3`, never an intermediate writer format

#### Scenario: Escaping receipt path is not deleted

- **WHEN** a receipt companion path resolves outside its selected adapter's storage through traversal, an absolute path, or a link
- **THEN** the system SHALL NOT delete that path
- **AND** it SHALL report the invalid record while continuing to process valid owned paths safely

#### Scenario: Mismatched project receipt confers no ownership

- **WHEN** receipt project identity differs from the active project
- **THEN** the system SHALL NOT delete anything based on that receipt
- **AND** it SHALL NOT recreate ownership from the lockfile in its place
- **AND** it SHALL report that the receipt could not be used
- **AND** it SHALL record ownership only for the identities it writes

#### Scenario: Unreadable receipt confers no ownership

- **WHEN** a receipt file exists but cannot be parsed or fails validation
- **THEN** the system SHALL treat every materialization as untracked
- **AND** it SHALL NOT delete any file
- **AND** it SHALL report that the receipt could not be used

#### Scenario: Unowned file survives cleanup

- **WHEN** a skill directory contains a file absent from receipt ownership
- **THEN** skill removal SHALL leave it unchanged

### Requirement: Mutable project state is read under the project lock

The system SHALL acquire the project's install lock before reading any mutable project state that a commit is derived from, including the project manifest, the lockfile, and the receipt. Reading such state before the lock is held SHALL NOT occur, because a concurrent operation may commit between the read and the write, and the later operation would then overwrite that commit from a snapshot taken before it existed.

Contention for the lock SHALL be the only failure the system can report before acquiring it. Every other failure — an absent, malformed, or unsupported-version manifest included — SHALL be reported after the lock is held and before any mutation, so a caller can distinguish "another operation owns this project" from "this project's state is unusable".

Advisory reads performed outside the lock for presentation, such as validating that the project manifest can be read before adapters are discovered, SHALL NOT be reused as the basis of a commit. In particular, the set of facets a removal operates on SHALL be decided from state read under the lock, not from a pre-lock validation of the requested names. An advisory read SHALL NOT decide an operation's outcome even when that outcome commits nothing: a removal whose requested names all appear undeclared SHALL still proceed to the commit, where the manifest read under the lock decides whether anything is removed.

#### Scenario: Lock contention is reported before project state is examined

- **WHEN** an install runs against a project whose install lock is already held
- **AND** the project manifest is absent, malformed, or declares an unsupported version
- **THEN** the system SHALL report the lock contention
- **AND** the system SHALL NOT report the manifest problem in its place

#### Scenario: A concurrent commit is not overwritten

- **WHEN** another operation commits new project state after this operation begins but before this operation acquires the lock
- **THEN** this operation SHALL derive its commit from the state committed by that operation
- **AND** the earlier snapshot SHALL NOT be written back over it

#### Scenario: A facet declared after validation is still removed

- **WHEN** a removal request names a facet that is not declared when the request is validated, but is declared when the lock is acquired
- **THEN** the system SHALL remove that facet
- **AND** a requested name that is undeclared under the lock SHALL remain a silent no-op

#### Scenario: An entirely undeclared removal request still reaches the commit

- **WHEN** every name in a removal request is undeclared at pre-lock validation
- **AND** one of those names is declared by a concurrent commit before the lock is acquired
- **THEN** the system SHALL remove that facet
- **AND** the operation SHALL NOT report a no-op decided before the lock was held

### Requirement: Resolved facet content is cached locally

When the system fetches and verifies a facet's content for the first time, the system SHALL retain that content in a local cache so that future installs of the same exact version SHALL NOT require a content download.

Cached content SHALL NOT be installed on trust: before each use, the system SHALL verify that the cached content still matches the integrity recorded for it when it was cached. Cached content that fails this verification SHALL be discarded and treated as absent (re-downloaded and re-verified), and SHALL NOT be installed or recorded in the lockfile.

The cache SHALL be addressed by the **fully-qualified exact version** of a facet, never by the presence or absence of a lockfile entry. Whenever the system holds an exact `name@version` or `@scope/name@version` to install — regardless of how that version was determined (an exact specifier, a satisfying lockfile entry, or a freshly resolved wildcard or `latest`) — the system SHALL consult the cache for that version before downloading, and SHALL use the cached content on a hit. For slash-containing facet identities, the system SHALL create any required cache parent directories before writing the cache entry.

#### Scenario: First fetch populates the cache

- **WHEN** the system installs a facet whose exact version is not present in the cache
- **THEN** the system SHALL fetch the facet's content
- **AND** the system SHALL verify the content's integrity
- **AND** the system SHALL store the verified content in the cache keyed by the exact version

#### Scenario: First fetch of a scoped facet populates the cache

- **WHEN** the system installs `@julian/cowsay@1.0.0` and that exact version is not present in the cache
- **THEN** the system SHALL fetch and verify the facet's content
- **AND** the system SHALL store the verified content in the cache keyed by `@julian/cowsay@1.0.0`
- **AND** the cache write SHALL NOT fail because the facet identity contains a slash

#### Scenario: Subsequent install of the same version hits the cache

- **WHEN** the system installs a facet whose exact version is already present in the cache
- **THEN** the system SHALL verify the cached content against the integrity recorded for it when it was cached
- **AND** the system SHALL use the cached content
- **AND** the system SHALL NOT download that facet's content

#### Scenario: Tampered cached content is discarded and re-fetched

- **WHEN** the system installs a facet whose exact version is present in the cache
- **AND** the cached content has been modified so it no longer matches the integrity recorded for it when it was cached
- **THEN** the system SHALL discard the tampered cache entry
- **AND** the system SHALL download the content again and verify it before use
- **AND** the system SHALL NOT install the tampered content
- **AND** the system SHALL NOT record the tampered content's integrity in the lockfile

#### Scenario: Cache hit does not depend on a lockfile entry

- **WHEN** the system holds an exact version to install whose content is cached
- **AND** the project has no lockfile entry for that facet
- **THEN** the system SHALL still use the cached content without downloading

#### Scenario: Freshly resolved version still checks the cache before downloading

- **WHEN** the system resolves a wildcard or `latest` to an exact version
- **AND** that exact version is already present in the cache
- **THEN** the system SHALL use the cached content
- **AND** the system SHALL NOT download that version again

#### Scenario: Cache location can be overridden

- **WHEN** an environment variable is set to a custom cache directory path
- **THEN** the system SHALL use the specified directory as the cache root
- **AND** all cache reads and writes SHALL occur under that directory

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

### Requirement: Lockfile-driven install honors the lock only when it satisfies the manifest

The project manifest is the source of truth; the lockfile is a record of resolution results that keeps an unchanged manifest reproducible. This requirement governs **reproduction** — installing a facet that is already recorded in the manifest and not part of an explicit add request. When a user runs install on a project that already has a lockfile, the system SHALL install the locked version and integrity hash for a facet **when the locked version satisfies that facet's manifest specifier**, and SHALL NOT perform version resolution for a satisfying entry. When the locked version does **not** satisfy the manifest specifier, the lockfile entry SHALL be treated as stale: the system SHALL resolve the manifest specifier against the registry. When the manifest declares a facet with no lockfile entry at all, the system SHALL likewise resolve the manifest specifier. If resolution succeeds, the system SHALL install the resolved version and SHALL record it in the lockfile; if the manifest specifier resolves to no published version, the system SHALL fail and SHALL leave the project unchanged. A locked exact version SHALL satisfy an exact specifier only when they are equal, SHALL satisfy a wildcard specifier only when the locked version falls within the wildcard's pinned components, and SHALL always satisfy an unconstrained specifier (`*` or `latest`). Resolution SHALL apply only to registry-sourced facets. Reproducing a satisfying entry SHALL still download the content when the exact version is absent from the cache; trusting the lockfile avoids version resolution, not content download.

#### Scenario: Lockfile entry is honored when it satisfies the manifest

- **WHEN** a user runs install
- **AND** the lockfile records a facet at an exact resolved version with an integrity hash
- **AND** that version satisfies the facet's manifest specifier
- **AND** the facet is not part of an explicit add request
- **THEN** the system SHALL install exactly that version (from the cache, or by downloading it on a cache miss)
- **AND** the system SHALL verify the content against the lockfile's integrity hash
- **AND** the system SHALL NOT perform version resolution

#### Scenario: Manifest specifier widens but lockfile still satisfies it

- **WHEN** a user's manifest specifies a wildcard version (e.g., `1.*`)
- **AND** the lockfile records a specific resolved version that satisfies it (e.g., `1.2.3`)
- **AND** the facet is not part of an explicit add request
- **THEN** install SHALL use `1.2.3`
- **AND** install SHALL NOT pick up `1.2.4` even if it has been published

#### Scenario: Absent lockfile entry triggers resolution

- **WHEN** a user's manifest declares a facet that is not present in the lockfile
- **THEN** the system SHALL resolve that specifier
- **AND** the system SHALL append the resolved version and integrity to the lockfile
- **AND** the system SHALL NOT re-resolve any other entry that is already locked and satisfying

#### Scenario: Stale lockfile entry triggers resolution

- **WHEN** the manifest specifier for a facet has changed (e.g., hand-edited from `1.*` to `2.*`) so the lockfile's recorded version no longer satisfies it
- **THEN** the system SHALL treat the entry as stale and SHALL resolve the manifest specifier against the registry
- **AND** the system SHALL replace the stale version, integrity, and asset record in the lockfile with the resolved result

#### Scenario: Manifest pins an exact version the lockfile does not match

- **WHEN** a user edits the manifest to pin an exact version (e.g., `0.1.2`) that differs from the lockfile's recorded version (e.g., `0.1.1`)
- **AND** the user runs install
- **THEN** the system SHALL treat the lockfile entry as stale and SHALL re-resolve the manifest's exact version against the registry
- **AND** if that exact version is published, the system SHALL install it and SHALL replace the lockfile's version, integrity, and asset record with the resolved result
- **AND** the system SHALL report the facet as updated from the previous version to the new one

#### Scenario: Manifest pins a version that does not exist in the registry

- **WHEN** a user edits the manifest to pin an exact version that does not exist in the registry (e.g., `0.1.2` with no such published version)
- **AND** the user runs install
- **THEN** the system SHALL fail with an error identifying the facet and the version that could not be found
- **AND** the system SHALL NOT record the nonexistent version in the lockfile
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: A stale re-resolve still verifies integrity of the freshly fetched content

- **WHEN** the system re-resolves a stale lockfile entry and fetches new content from the registry
- **THEN** the system SHALL verify the freshly fetched content through the full registry integrity protocol before writing any asset
- **AND** the system SHALL NOT check the new content against the discarded stale entry's integrity hash

#### Scenario: Lockfile entry and its source provenance always describe the same artifact

- **WHEN** the system writes or updates a lockfile entry for a facet
- **THEN** the entry's recorded source provenance, resolved version, and integrity hash SHALL all describe the same resolved artifact
- **AND** the system SHALL NOT record source provenance whose version disagrees with the entry's resolved version and integrity hash

#### Scenario: A registry entry has no version-bearing source to disagree with

- **WHEN** a user adds or installs a registry-sourced facet whose manifest specifier is unresolved (a bare name, `latest`, or a wildcard)
- **THEN** the lockfile entry's source SHALL record the registry origin only
- **AND** the lockfile entry SHALL NOT record the unresolved specifier anywhere
- **AND** the entry's `version` SHALL be the resolved exact version

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

### Requirement: An invalid lockfile fails install in every mode

When a lockfile exists but cannot be read or does not satisfy the published schema, the system SHALL fail the install and SHALL leave the project unchanged, regardless of whether frozen-lockfile mode is in effect. The system SHALL NOT silently treat an invalid lockfile as absent and SHALL NOT silently regenerate it. Recovery SHALL be available by deleting the lockfile and re-running a non-frozen install, which regenerates a valid lockfile from the manifest.

#### Scenario: Non-frozen install fails on an invalid lockfile

- **WHEN** a user runs a non-frozen install
- **AND** a lockfile exists but does not satisfy the published schema (for example, an entry recorded under an older, untagged source shape)
- **THEN** the system SHALL fail with an error stating the lockfile is invalid
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Deleting an invalid lockfile lets a non-frozen install regenerate it

- **WHEN** a user deletes an invalid lockfile and runs a non-frozen install
- **THEN** the system SHALL resolve the manifest's facets and write a new lockfile that satisfies the published schema
- **AND** every registry entry's recorded source SHALL be the registry origin with no version specifier

### Requirement: A git facet that cannot be pinned to a commit fails the install

When the system installs a git-sourced facet, it SHALL resolve the cloned content to a specific commit and record that commit in the lockfile. If a git clone succeeds but the system cannot resolve it to a commit, the system SHALL fail the install with an error identifying the facet, and SHALL leave the manifest, lockfile, and on-disk adapter state unchanged. The system SHALL NOT write a git lockfile entry that lacks a commit.

#### Scenario: Git facet is pinned to its resolved commit

- **WHEN** a user adds or installs a git-sourced facet and the clone resolves to a commit
- **THEN** the system SHALL record that commit in the facet's git source
- **AND** the recorded git source SHALL NOT include the symbolic ref the user requested

#### Scenario: Git facet whose commit cannot be resolved fails the install

- **WHEN** a user adds or installs a git-sourced facet and the clone cannot be resolved to a commit
- **THEN** the system SHALL fail with an error identifying the facet
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

### Requirement: Declared MCP servers do not block installation

When a facet declares MCP server dependencies, the system SHALL surface them to the user but SHALL NOT block the install. Server materialization is out of scope for this change.

#### Scenario: Facet with declared servers installs with a warning

- **WHEN** the system installs a facet that declares one or more MCP servers
- **THEN** the system SHALL print a warning identifying each declared server by name
- **AND** the warning SHALL state that server installation is not yet supported and that servers will be skipped
- **AND** the warning SHALL include a documentation pointer for current server status
- **AND** the install SHALL otherwise proceed normally

### Requirement: Facets that compose other facets are rejected

When a facet declares dependencies on other facets (composition), the system SHALL reject the install. Composition is out of scope for this change.

#### Scenario: Composing facet is rejected at install time

- **WHEN** the system encounters a facet whose manifest declares dependencies on other facets
- **THEN** the system SHALL abort the install with a clear error
- **AND** the error SHALL identify the composing facet by name
- **AND** the error SHALL state that facet composition is not supported

### Requirement: Failed installs leave the project unchanged

The project manifest, the lockfile, and the receipt SHALL be written together as a single transactional commit at the end of a successful operation. The system SHALL NOT write the manifest ahead of resolving and materializing a change. When an install, add, or remove operation fails for any reason, the manifest, the lockfile, and the receipt on disk SHALL all remain exactly as they were before the operation. The user SHALL NOT be left with a project whose manifest references a facet that was never installed, nor with a lockfile or receipt that records a state that was never materialized.

#### Scenario: Add failure leaves manifest, lockfile, and receipt unchanged

- **WHEN** a user adds a facet
- **AND** any step (resolution, download, integrity, materialization, or the final write) fails
- **THEN** the manifest on disk SHALL match its pre-operation contents
- **AND** the lockfile on disk SHALL match its pre-operation contents
- **AND** the receipt on disk SHALL match its pre-operation contents
- **AND** the system SHALL surface the failure to the user

#### Scenario: Manifest, lockfile, and receipt are written together on success

- **WHEN** an add, remove, or install operation succeeds
- **THEN** the system SHALL write the updated manifest, lockfile, and receipt as one commit
- **AND** no one of the three files SHALL be left written while another is not

### Requirement: Facet operations require compatible selected adapters before mutation

Before adding, removing, or installing facets, the system SHALL verify that every selected installed adapter declares an API supported by the current CLI. If a selected adapter is missing its declaration, has a malformed or unsupported declaration, conflicts with its recorded package declaration, or cannot be loaded as a valid adapter, the operation SHALL fail before invoking any adapter contract method or writing project or materialized state. The failure SHALL identify every incompatible selected adapter and provide the best available compatible-install command. The system SHALL NOT automatically upgrade or replace an incompatible adapter during a facet operation.

This adapter-compatibility preflight SHALL run before archive-version dispatch and before any per-file integrity reconciliation, so an adapter declaring the superseded positional API `0.0` SHALL cause a `0.1`-only CLI to fail on the adapter — with reinstall guidance — before the archive's `facetVersion` is examined. The adapter API axis and the archive-format axis SHALL be classified independently.

Facet removal of tracked materialization SHALL remain independent of cached facet content and network access, but it SHALL still require compatible selected adapters because deleting materialized assets invokes each selected adapter's contract. A removal whose remaining desired state is untracked SHALL be permitted to resolve, because it must materialize that state before recording ownership of it.

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

### Requirement: Removing a facet uninstalls it

When a user removes a facet from a project, the system SHALL drop the facet from the project manifest, reconcile its effective materialized ownership across every selected adapter, and update the lockfile and receipt so neither records the facet—all in a single operation. A user SHALL NOT need to run a separate install step after removing. The ownership to reconcile SHALL be taken from the receipt alone, so removal SHALL require neither cache nor network access when the facet's materialization is tracked, and SHALL delete nothing on disk when it is untracked. The system SHALL delete a recorded effective adapter identity only when no desired asset retains it, SHALL delete each obsolete identity once, and SHALL aggregate historical duplicate claims so a retained desired asset is never deleted. Skill deletion SHALL supply the validated authored companion ownership in the adapter deletion request and SHALL remove the primary and every obsolete owned companion atomically while leaving unowned files untouched.

A non-frozen removal-only operation SHALL NOT fetch, rebuild, or reverify a remaining facet whose locked entry already answers the operation. It SHALL instead refine the remaining locked entries structurally from local state: it SHALL confirm locally that every remaining facet has a locked entry still matching its manifest source and specifier, SHALL plan over the remaining locked asset set so an already-recorded collision among the facets that stay is still reported, SHALL carry each remaining entry's source, version, integrity, file records, and unrecognized fields forward unchanged, and SHALL attach each remaining asset's recorded disposition — refining an entry that predates dispositions to authored materialization. Refinement is lossless, so it SHALL be permitted for every supported lockfile version, and the resulting lockfile SHALL be written at the current version. A frozen operation SHALL NOT refine, because it SHALL NOT rewrite the lockfile at all. Remaining materialized assets SHALL NOT be rewritten or deleted, and lockfile entries for facets the manifest no longer declares SHALL be dropped.

Because the lockfile is shared state and the receipt is machine-local, refinement SHALL require every remaining materialization to be tracked before writing: each remaining facet SHALL have a receipt record, and that record's version, its materialized assets, each such asset's materialization disposition, and each such asset's owned file set SHALL agree with the locked entry. A remaining facet the receipt does not record, and any receipt that cannot be loaded — absent, corrupt, or path-mismatched — SHALL force ordinary resolution, because the operation would otherwise commit a claim on files this machine has no evidence it wrote, and the next operation would read that claim as authority to delete them. The committed receipt SHALL carry the witnessed records forward rather than re-derive them from the locked entries, so an operation that materializes nothing SHALL NOT record an effective identity it did not write. Assets the receipt records but the remaining locked entries no longer list SHALL be dropped from the committed receipt while remaining subject to ownership reconciliation.

A refinement SHALL also confirm that every effective identity a remaining facet retains was previously claimed only by that facet. Identity comparison SHALL fold asset type into its materialization namespace and fold names portably, so a claim differing only by asset type within one namespace, by case, or by Unicode normalization is still recognized as the same identity. An identity that no remaining facet retains SHALL NOT block refinement, because ownership reconciliation removes it.

A removal-only operation SHALL observe cancellation before it deletes any materialized asset and again after deletion completes and before the manifest, lockfile, and receipt are written. A cancellation observed before deletion SHALL leave every file untouched and SHALL report that no mutation occurred; a cancellation observed after deletion SHALL roll the deletions back and report that outcome. Cancellation SHALL NOT be observed after the commit, which is the operation's transaction boundary.

Whether an operation is removal-only SHALL be decided from the requested change, not from how many requested names the project still declares. A removal request whose names are all already absent SHALL therefore remain eligible for refinement rather than requiring resolution of every unrelated declared facet.

Refinement SHALL apply only when local state answers the operation completely. The system SHALL fall back to ordinary resolution rather than guessing when any of the following holds: a remaining facet has no locked entry; its locked entry no longer matches its manifest source or specifier; the remaining locked set does not plan cleanly; an identity a remaining facet retains was also claimed by a facet the operation drops; this machine's receipt cannot be loaded; this machine's receipt does not record a remaining facet; this machine's receipt disagrees with a remaining facet's locked entry; or the manifest declares materialization intent the lockfile does not record. Each of those cases requires content this machine may not have, and each would otherwise be resolved by writing an asset, which removal does not do. The offline guarantee therefore covers fully tracked, witnessed state; a removal whose remaining desired state is untracked SHALL require resolution and SHALL fail rather than delete untracked files when that resolution is unavailable.

Before deleting any materialized asset, the system SHALL verify that every selected installed adapter loads as a valid adapter and declares an API supported by the CLI. When a selected adapter has a missing, malformed, unsupported, or metadata-inconsistent API declaration, or cannot be loaded as a valid adapter, removal SHALL fail before deleting any materialized asset and SHALL leave the project manifest, lockfile, receipt, and materialized assets unchanged. An adapter declaring the superseded positional API `0.0` SHALL be unsupported by a CLI whose supported set is the tagged-contract API `0.1` and SHALL trigger this failure. This compatibility precondition SHALL require neither cache access nor network access; once the adapter incompatibility is repaired, a removal whose remaining materialization is tracked SHALL remain able to use the receipt without either resource.

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
- **AND** every remaining materialization is tracked
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** receipt ownership SHALL allow removal without any cache read or network access

#### Scenario: Untracked removal without resolution fails rather than deleting

- **WHEN** a removal's remaining desired state is untracked
- **AND** the content needed to materialize it is uncached and its registry unreachable
- **THEN** the operation SHALL fail
- **AND** it SHALL leave the manifest, lockfile, receipt, and every untracked file unchanged

#### Scenario: Untracked removal resolves when content is reachable

- **WHEN** a removal's remaining desired state is untracked
- **AND** the content needed to materialize it is available
- **THEN** the operation SHALL materialize the remaining desired state and record ownership of it
- **AND** it SHALL drop the removed facet from the manifest and lockfile
- **AND** it SHALL leave the removed facet's untracked files on disk

#### Scenario: Removal succeeds when a remaining facet is unavailable

- **WHEN** a multi-facet project removes one facet
- **AND** a remaining facet's content is uncached and its registry unreachable
- **AND** every remaining materialization is tracked
- **THEN** removal SHALL succeed without fetching, rebuilding, or reverifying that remaining facet
- **AND** the committed lockfile SHALL declare the current version
- **AND** the remaining facet's recorded source, version, integrity, file records, and unrecognized fields SHALL be unchanged
- **AND** the remaining facet's materialized assets SHALL be untouched

#### Scenario: Removing an already-absent facet stays offline

- **WHEN** every requested removal names a facet the project no longer declares
- **AND** a remaining facet's content is uncached and its registry unreachable
- **AND** every remaining materialization is tracked
- **THEN** removal SHALL succeed without fetching, rebuilding, or reverifying that remaining facet
- **AND** the project manifest SHALL be unchanged

#### Scenario: Unrecorded remaining intent is not applied by a removal

- **WHEN** a removal-only operation finds a remaining facet whose declared materialization intent its locked entry does not record
- **THEN** the system SHALL NOT record that intent without materializing it
- **AND** the operation SHALL fall back to ordinary resolution instead of refining

#### Scenario: A remaining facet the receipt contradicts is not refined

- **WHEN** a removal-only operation finds a remaining facet the receipt records, whose locked entry describes a materialization the receipt does not
- **THEN** the operation SHALL fall back to ordinary resolution instead of refining
- **AND** the committed receipt SHALL NOT claim an identity this machine did not materialize

#### Scenario: A remaining facet the receipt omits entirely is not refined

- **WHEN** a removal-only operation finds a remaining facet the receipt does not record at all
- **THEN** the operation SHALL treat that facet's materialization as untracked
- **AND** it SHALL fall back to ordinary resolution instead of refining
- **AND** the committed receipt SHALL record only the identities the operation wrote

#### Scenario: A receipt that cannot be loaded is not refined

- **WHEN** a removal-only operation finds an absent, corrupt, or path-mismatched receipt
- **THEN** the operation SHALL fall back to ordinary resolution instead of refining
- **AND** it SHALL rewrite remaining materialized assets before recording their identities
- **AND** it SHALL NOT delete any untracked file

#### Scenario: An identity a removed facet also claimed is rematerialized

- **WHEN** a removal drops a facet that claimed the same effective identity a remaining facet retains
- **THEN** the operation SHALL fall back to ordinary resolution instead of refining
- **AND** the retained identity SHALL end the operation containing the remaining facet's content

#### Scenario: An identity contested only by removed facets does not block refinement

- **WHEN** the facets a removal drops contested an effective identity no remaining facet retains
- **THEN** the operation SHALL still refine
- **AND** it SHALL delete that identity without fetching, rebuilding, or reverifying any remaining facet

#### Scenario: A removal cancelled before deletion changes nothing

- **WHEN** a removal-only operation is cancelled before it deletes any materialized asset
- **THEN** the manifest, lockfile, receipt, and materialized assets SHALL remain unchanged
- **AND** the failure SHALL report that no rollback was needed

#### Scenario: A removal cancelled after deletion is rolled back

- **WHEN** a removal-only operation is cancelled after deleting materialized assets and before committing
- **THEN** the system SHALL restore the deleted assets
- **AND** the manifest, lockfile, and receipt SHALL remain unchanged

#### Scenario: Remaining unrecognized fields survive an offline removal

- **WHEN** a removal-only operation refines a lockfile whose remaining entry carries an unrecognized field
- **THEN** the committed lockfile SHALL still contain that field

#### Scenario: Removing an untracked facet deletes nothing from disk

- **WHEN** a removal drops a facet whose materialization no receipt record covers
- **THEN** the manifest and lockfile SHALL no longer declare it
- **AND** the system SHALL NOT delete any file on its behalf
- **AND** the outcome SHALL be reported distinctly from a removal that reconciled tracked ownership, so it is not presented as having deleted files

#### Scenario: Incompatible adapter blocks removal

- **WHEN** a selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** removal SHALL fail before deleting materialized assets
- **AND** the project manifest, lockfile, receipt, and materialized assets SHALL remain unchanged
- **AND** the failure SHALL NOT require or result from cache access or network access
- **AND** after the adapter incompatibility is repaired, removal SHALL remain able to use the receipt without cache or network access

### Requirement: Removing multiple declared facets is transactional

When a user removes more than one facet in a single invocation, the system SHALL remove all of the declared facets together. If the removal of any declared facet fails (asset deletion or the final commit of the manifest, lockfile, and receipt), the system SHALL remove none of them and SHALL leave the manifest, lockfile, receipt, and adapter state unchanged. Names that are not declared in the project manifest SHALL be silently ignored and SHALL NOT cause the operation to fail.

#### Scenario: All declared facets are removed together

- **WHEN** a user removes two or more facets that are all declared in the project manifest
- **THEN** the system SHALL remove every named facet's manifest entry, assets, lockfile entry, and receipt entry
- **AND** the operation SHALL succeed only if every declared facet was removed

#### Scenario: Undeclared names are ignored in a multi-facet removal

- **WHEN** a user removes two or more facets and at least one of them is not declared in the project manifest
- **THEN** the system SHALL remove every *declared* facet in the request
- **AND** the system SHALL silently ignore the undeclared names
- **AND** the operation SHALL succeed if every declared facet was removed successfully

### Requirement: Removing an undeclared facet is a silent no-op

When a user removes a facet that is not declared in the project manifest, the system SHALL silently ignore the name. The project manifest, lockfile, receipt, and adapter state SHALL remain unchanged for that name. When every requested name is undeclared under the project lock, the operation SHALL succeed and SHALL report that no changes were made. That determination SHALL be made by the commit, under the lock — never by a pre-lock read — so a request whose names all appear undeclared SHALL still satisfy the operation's ordinary preconditions, including adapter availability.

#### Scenario: Removing a facet that is not declared

- **WHEN** a user removes a facet whose name does not appear in the project manifest
- **THEN** the system SHALL leave the project manifest, lockfile, receipt, and adapter state unchanged
- **AND** the system SHALL NOT fail with an error

#### Scenario: All requested names are undeclared

- **WHEN** a user removes one or more facets and none of them are declared in the project manifest
- **THEN** the system SHALL exit successfully
- **AND** the system SHALL report that no changes were made

### Requirement: Failed removals leave the project unchanged

When a remove operation fails for any reason, the manifest, lockfile, and receipt on disk SHALL all remain exactly as they were before the operation. The user SHALL NOT be left with a project whose manifest no longer references a facet whose assets were never removed, nor with a lockfile or receipt that records a state that was never materialized.

#### Scenario: Removal failure leaves manifest, lockfile, and receipt unchanged

- **WHEN** a user removes a facet
- **AND** any step (asset deletion or the final commit of the manifest, lockfile, and receipt) fails
- **THEN** the manifest on disk SHALL match its pre-operation contents
- **AND** the lockfile on disk SHALL match its pre-operation contents
- **AND** the receipt on disk SHALL match its pre-operation contents
- **AND** the system SHALL surface the failure to the user

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
- **AND** the authored identity every claimant aliased away from SHALL be reconciled as obsolete

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

The system SHALL plan deletion and replacement from the complete tracked previous ownership and complete desired effective set. Previous ownership SHALL be read from the receipt alone. A materialized identity SHALL be deleted only when the receipt records it and no desired asset still claims its adapter identity. Cross-facet ownership transfer SHALL replace content without leaving the retained identity deleted. Duplicate historical claims SHALL be aggregated, each obsolete identity SHALL be deleted at most once per adapter, and all recorded owned companions absent from the new owner SHALL be removed while unowned files remain untouched.

Changing an alias SHALL delete the old effective identity and write the new one transactionally. Changing to omitted SHALL delete prior ownership; removing omission SHALL materialize the asset. A disposition-only change SHALL be reported as updated, while disk-only drift SHALL remain repaired.

#### Scenario: Ownership transfer retains the identity

- **WHEN** one facet is removed while another desired asset takes its effective name
- **THEN** the identity SHALL contain the new owner's content after success
- **AND** it SHALL NOT be left deleted

#### Scenario: Alias change moves owned files

- **WHEN** an alias changes from `vendor-review` to `partner-review`
- **THEN** the old owned files SHALL be deleted and the new effective asset SHALL be written in one operation

#### Scenario: Historical duplicate claims do not delete a retained identity

- **WHEN** a receipt has duplicate historical claims for one adapter identity and the desired set retains that identity
- **THEN** the identity SHALL NOT be deleted
- **AND** companions absent from the retained ownership SHALL be removed

#### Scenario: Every claimant aliased away vacates the authored identity

- **WHEN** a tracked facet is materialized under an authored name, another facet contributes the same authored name, and the accepted resolution assigns every claimant a distinct alias
- **THEN** the vacated effective identity SHALL be deleted before any alias is written
- **AND** each alias SHALL contain its own facet's authored content
- **AND** the committed receipt SHALL record both aliased identities and SHALL NOT record the vacated one
- **AND** the disposition-only change SHALL be reported as updated while the newly contributing facet is reported as installed

#### Scenario: A lockfile-only claim authorizes no deletion

- **WHEN** the lockfile records a materialized asset that no receipt record covers
- **THEN** the system SHALL NOT delete anything on the strength of that entry
- **AND** the identity SHALL be written, and only then recorded, if the desired state names it

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
