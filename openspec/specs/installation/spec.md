## Purpose

The lockfile (`facets.lock`) records the exact resolved state of installed facets so that installations are reproducible across machines and environments. This spec defines what a valid lockfile contains.

The closed-alpha lockfile shape is **adapter-agnostic**: it records what each facet contributes (scope/type/name tuples) and leaves materialization to the installer. The installer applies the same asset set to every selected adapter, so the lockfile never embeds per-adapter state.

## Requirements

### Requirement: Lockfile declares a version

The lockfile SHALL include a top-level `lockfileVersion` integer. The CLI SHALL bump this on breaking shape changes and refuse to load lockfiles with a version it does not understand.

#### Scenario: Missing lockfile version

- **WHEN** a lockfile omits `lockfileVersion`
- **THEN** the system SHALL reject the lockfile

### Requirement: Each facet entry records source provenance

For every facet in `facets`, the lockfile SHALL record the original source specifier and (for git sources) the symbolic ref and resolved commit SHA. Local sources SHALL omit `ref` and `commit`.

#### Scenario: Valid git-source entry

- **WHEN** a lockfile facet entry includes `source`, `ref`, `commit`, `version`, `integrity`, and `assets`
- **THEN** the system SHALL accept the entry

#### Scenario: Valid local-source entry

- **WHEN** a lockfile facet entry includes `source: "file:./..."`, `version`, `integrity`, and `assets`, and omits `ref` / `commit`
- **THEN** the system SHALL accept the entry

### Requirement: Each facet entry captures identity and integrity

Every facet entry SHALL include `version` (from the facet's `facet.json`) and `integrity` (the sha256 of the built `.facet` archive). Missing either field SHALL cause the lockfile to be rejected.

#### Scenario: Missing integrity hash

- **WHEN** a facet entry omits `integrity`
- **THEN** the system SHALL reject the lockfile

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every facet entry SHALL include an `assets` array whose members are `{scope, type, name}` tuples. `scope` SHALL be one of `system | user | project`. `type` SHALL be one of `skill | agent | command`. No per-adapter fields live here — the installer applies the asset set to every selected adapter ("same thing per adapter").

#### Scenario: Valid asset tuple

- **WHEN** an asset entry has `scope: "user"`, `type: "skill"`, and `name: "planning"`
- **THEN** the system SHALL accept the entry

#### Scenario: Unknown asset scope

- **WHEN** an asset entry has `scope: "global"`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Unknown asset type

- **WHEN** an asset entry has `type: "hook"`
- **THEN** the system SHALL reject the lockfile

### Requirement: A lockfile without facets is valid

A project that declares no facets in `facets.json` SHALL produce a valid lockfile with an empty `facets` object.

#### Scenario: Empty facets map

- **WHEN** a lockfile contains `lockfileVersion` and `facets: {}`
- **THEN** the system SHALL accept the lockfile

### Requirement: Unrecognized fields are tolerated

The system SHALL accept lockfiles containing fields not defined in the current schema. Unrecognized fields SHALL be preserved, not stripped or rejected.

#### Scenario: Unknown field in lockfile

- **WHEN** a lockfile contains a field not defined in the schema (e.g., `generatedAt: "2026-04-18"`)
- **THEN** the system SHALL accept the lockfile
- **AND** the field SHALL be present in the loaded result

### Requirement: Adding a facet installs it

When a user adds a facet to a project, the system SHALL fetch its content, verify its integrity, materialize its assets into every selected adapter, and update the lockfile in a single operation. A user SHALL NOT need to run a separate install step after adding.

#### Scenario: Adding a registry facet installs it

- **WHEN** a user adds a registry facet to a project that has at least one selected adapter
- **THEN** the system SHALL update the project manifest to reference the facet
- **AND** the system SHALL fetch the facet's content
- **AND** the system SHALL verify the facet's integrity before any assets are written
- **AND** the system SHALL materialize the facet's assets into every selected adapter
- **AND** the system SHALL update the lockfile to record the resolved version, integrity hash, and asset list
- **AND** the operation SHALL complete in a single command invocation

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

When no manifest entry for the facet exists, or the existing entry's value is not a valid version specifier, the system SHALL record the resolved exact version (`name@MAJOR.MINOR.PATCH`). When a manifest entry already exists and its value is a valid version specifier, the system SHALL preserve that value unchanged, so that a re-add without a version does not overwrite a version the user previously chose.

#### Scenario: Bare facet name is recorded as exact version

- **WHEN** a user adds a registry facet using only its name (no version)
- **AND** no entry for that facet exists in the project manifest
- **THEN** the system SHALL resolve the latest published version
- **AND** the system SHALL record `name@MAJOR.MINOR.PATCH` in the project manifest
- **AND** the system SHALL NOT record the facet name as the version value

#### Scenario: @latest tag is equivalent to a bare name

- **WHEN** a user adds a registry facet using the literal `name@latest` form
- **AND** no entry for that facet exists in the project manifest
- **THEN** the system SHALL resolve the latest published version
- **AND** the system SHALL record `name@MAJOR.MINOR.PATCH` in the project manifest
- **AND** the resulting manifest, lockfile, and on-disk state SHALL be identical to what would have been produced by the bare-name form

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
- **AND** the system SHALL replace the invalid value with the resolved exact version (`name@MAJOR.MINOR.PATCH`) in the project manifest

#### Scenario: Adding a git or local facet records the full source specifier

- **WHEN** a user adds a facet from a git source or a local path
- **THEN** the system SHALL record the full source specifier (the git URL with any ref, or the local path) as the manifest value
- **AND** the system SHALL NOT replace it with a version specifier

### Requirement: Source specifier syntax matches established package-manager conventions

When a user specifies a facet source, the system SHALL accept the same set of forms users expect from established package managers, and SHALL reject obsolete or deprecated prefixes with a clear migration message.

#### Scenario: Registry name is accepted

- **WHEN** a user specifies a source of the form `name` or `name@version`
- **THEN** the system SHALL treat it as a registry source

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

### Requirement: Resolved facet content is cached locally

When the system fetches and verifies a facet's content for the first time, the system SHALL retain that content in a local cache so that future installs of the same identity SHALL NOT require a network fetch and SHALL NOT re-verify content already trusted.

#### Scenario: First fetch populates the cache

- **WHEN** the system installs a facet whose resolved identity is not present in the cache
- **THEN** the system SHALL fetch the facet's content
- **AND** the system SHALL verify the content's integrity
- **AND** the system SHALL store the verified content in the cache keyed by the resolved identity

#### Scenario: Subsequent fetch hits the cache

- **WHEN** the system installs a facet whose resolved identity is already present in the cache
- **THEN** the system SHALL use the cached content
- **AND** the system SHALL NOT contact the network for that facet
- **AND** the system SHALL NOT recompute integrity for the cached content

#### Scenario: Cache location can be overridden

- **WHEN** an environment variable is set to a custom cache directory path
- **THEN** the system SHALL use the specified directory as the cache root
- **AND** all cache reads and writes SHALL occur under that directory

### Requirement: Integrity is verified before any asset is written

The system SHALL verify the integrity of fetched facet content before writing any asset to disk. If verification fails, the system SHALL abort the install, leave the project unchanged, and report the mismatch as a security error.

#### Scenario: Registry content fails its declared integrity

- **WHEN** the system fetches a facet from the registry
- **AND** the fetched content's hash does not match the integrity hash declared by the registry
- **THEN** the system SHALL abort the install
- **AND** the system SHALL NOT write any asset to any adapter
- **AND** the system SHALL NOT modify the project manifest or lockfile
- **AND** the system SHALL print a security error identifying the affected facet, the expected hash, and the observed hash

#### Scenario: Registry content fails its self-declared content hash

- **WHEN** the system fetches a facet from the registry
- **AND** the registry's declared integrity matches the archive
- **AND** the archive's internal content hash does not match the archive's recomputed content hash
- **THEN** the system SHALL abort the install
- **AND** the system SHALL print a security error indicating internal archive corruption

#### Scenario: Cached registry content fails its lockfile integrity

- **WHEN** the system installs a registry facet from the cache
- **AND** the lockfile has an integrity hash for that facet
- **AND** the cached content's hash does not match the lockfile's integrity
- **THEN** the system SHALL abort the install
- **AND** the system SHALL print a security error identifying the affected facet

#### Scenario: Git or local content fails its computed integrity

- **WHEN** the system builds a facet from a git or local source
- **AND** the built artifact's hash does not match the lockfile's integrity for that facet
- **THEN** the system SHALL abort the install
- **AND** the system SHALL print a security error identifying the affected facet

### Requirement: Lockfile-driven install does not re-resolve specifiers

When a user runs install on a project that already has a lockfile, the system SHALL install exactly the versions and integrity hashes recorded in the lockfile. The system SHALL NOT re-resolve specifiers against the registry. Refreshing locked versions against the project manifest SHALL be a separate, opt-in operation.

#### Scenario: Lockfile entry is honored verbatim

- **WHEN** a user runs install
- **AND** the lockfile records a facet at an exact resolved version with an integrity hash
- **THEN** the system SHALL fetch (or read from cache) exactly that version
- **AND** the system SHALL verify the fetched content against the lockfile's integrity hash
- **AND** the system SHALL NOT contact the registry to look up newer versions

#### Scenario: Manifest specifier widens but lockfile narrows

- **WHEN** a user's manifest specifies a wildcard version (e.g., `1.*`)
- **AND** the lockfile records a specific resolved version (e.g., `1.2.3`)
- **THEN** install SHALL use `1.2.3`
- **AND** install SHALL NOT pick up `1.2.4` even if it has been published

#### Scenario: New manifest entry without lockfile coverage triggers resolution

- **WHEN** a user's manifest declares a facet that is not present in the lockfile
- **THEN** the system SHALL resolve that specifier
- **AND** the system SHALL append the resolved version and integrity to the lockfile
- **AND** the system SHALL NOT re-resolve any other entry that is already locked

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

When an install operation fails for any reason after the manifest has been modified, the system SHALL restore the manifest to its pre-operation state. The user SHALL NOT be left with a project whose manifest references a facet that was never installed.

#### Scenario: Install failure rolls back the manifest

- **WHEN** the system has updated the project manifest as part of an add operation
- **AND** a subsequent step (resolution, fetch, integrity, materialization, lockfile write) fails
- **THEN** the system SHALL restore the manifest to its exact pre-operation contents
- **AND** the system SHALL surface the failure to the user

#### Scenario: Install failure leaves the lockfile unchanged

- **WHEN** an install operation fails before the lockfile is committed
- **THEN** the lockfile on disk SHALL match its pre-operation contents
