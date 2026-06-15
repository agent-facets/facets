## MODIFIED Requirements

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

### Requirement: Adding a facet without a version stores the resolved version pinned

When a user adds a registry facet without specifying a version, the system SHALL resolve the latest published version and SHALL record a version specifier in the project manifest. The system SHALL NOT record the facet name in the version position. A bare name and the literal tag `@latest` SHALL be equivalent and SHALL produce identical results. The user SHALL NOT need to specify a version explicitly to get reproducible builds.

When no manifest entry for the facet exists, or the existing entry's value is not a valid version specifier, the system SHALL record the resolved exact version (`name@MAJOR.MINOR.PATCH` for unscoped names, `@scope/name@MAJOR.MINOR.PATCH` for scoped names) in the project manifest. When a manifest entry already exists and its value is a valid version specifier, the system SHALL preserve that value unchanged, so that a re-add without a version does not overwrite a version the user previously chose.

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
