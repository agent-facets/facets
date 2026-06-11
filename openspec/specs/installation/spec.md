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

#### Scenario: Explicit @latest tag records "latest" in the manifest

- **WHEN** a user adds a registry facet using the literal `name@latest` form
- **THEN** the system SHALL resolve the latest published version
- **AND** the system SHALL record `latest` as the version specifier in the project manifest (preserving the user's explicit intent to float)
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

The system SHALL maintain a machine-local install record — the **receipt** — of what it has materialized into each project's adapter trees, separate from the lockfile. Because the lockfile is shared and version-controlled, it cannot reliably describe what a particular machine has on disk — a change pulled from version control can remove a lockfile entry while that facet's assets remain materialized in the working copy. The receipt SHALL persist outside the project's version-controlled files and SHALL survive operations that rewrite the lockfile from outside the system. Each project SHALL have its own receipt, identified by the project's canonical on-disk location, so that two distinct projects never share a receipt and concurrent operations in different projects never contend on one. For each materialized facet the receipt SHALL retain enough information — at minimum the asset set it contributed — to remove that facet's assets later without consulting the cache or the network. A project that has no receipt yet SHALL have one created from the current lockfile on the next operation.

The system SHALL treat the receipt, not the on-disk lockfile, as the description of what is currently materialized when deciding which assets to remove. When a facet is recorded as materialized but is no longer wanted (absent from the manifest and not being added), the system SHALL delete that facet's recorded assets from every selected adapter and SHALL drop the facet from both the lockfile and the receipt. This removal SHALL succeed without any network access and without any cached content, because the receipt itself carries the asset set to delete. In frozen-lockfile mode, this cleanup applies only after the frozen consistency check passes; an orphaned lockfile entry that the consistency check rejects SHALL cause the operation to fail before any cleanup occurs (see the frozen-lockfile requirement).

The receipt SHALL be treated as untrusted input. Before acting on a receipt, the system SHALL verify it corresponds to the project being operated on; a receipt that does not (corruption, collision, or tampering) SHALL be ignored and recreated rather than acted upon. When deleting assets named by the receipt, the system SHALL delete only files that resolve to locations inside the project's adapter trees; a recorded path that resolves outside them SHALL NOT be deleted, and the system SHALL report it. A corrupted receipt MAY cause a cleanup to be skipped; it SHALL NOT cause deletion outside the project's adapter trees.

#### Scenario: A pulled change that drops a lockfile entry still cleans up its assets

- **WHEN** a change pulled from version control removes a facet from both the manifest and the lockfile
- **AND** that facet's assets were previously materialized on this machine
- **AND** the user runs install
- **THEN** the system SHALL detect the facet as materialized but no longer wanted via the receipt
- **AND** the system SHALL delete that facet's assets from every selected adapter
- **AND** the system SHALL NOT leave the facet's assets orphaned on disk

#### Scenario: Removal needs neither cache nor network

- **WHEN** a user removes a facet whose content is absent from the cache and whose registry is unreachable
- **THEN** the system SHALL still delete that facet's assets using the asset set recorded in the receipt
- **AND** the removal SHALL succeed

#### Scenario: A project without a receipt bootstraps one

- **WHEN** the system operates on a project that has a lockfile but no receipt yet
- **THEN** the system SHALL create the receipt from the current lockfile's entries
- **AND** subsequent operations SHALL use the receipt as the description of what is materialized

#### Scenario: A receipt naming a path outside the project never causes deletion there

- **WHEN** the receipt contains an asset path that resolves outside the project's adapter trees (for example via `..` segments, an absolute path elsewhere, or a symlink)
- **AND** the system would otherwise remove that facet's assets
- **THEN** the system SHALL NOT delete the escaping path
- **AND** the system SHALL report the invalid entry
- **AND** valid asset paths inside the adapter trees SHALL still be processed normally

#### Scenario: A receipt that does not match its project is ignored, not acted on

- **WHEN** the system loads a receipt whose recorded project identity does not match the project being operated on
- **THEN** the system SHALL NOT delete any assets based on that receipt
- **AND** the system SHALL recreate the receipt from the current lockfile as if none existed

### Requirement: Resolved facet content is cached locally

When the system fetches and verifies a facet's content for the first time, the system SHALL retain that content in a local cache so that future installs of the same exact version SHALL NOT require a content download.

Cached content SHALL NOT be installed on trust: before each use, the system SHALL verify that the cached content still matches the integrity recorded for it when it was cached. Cached content that fails this verification SHALL be discarded and treated as absent (re-downloaded and re-verified), and SHALL NOT be installed or recorded in the lockfile.

The cache SHALL be addressed by the **fully-qualified exact version** of a facet, never by the presence or absence of a lockfile entry. Whenever the system holds an exact `name@version` to install — regardless of how that version was determined (an exact specifier, a satisfying lockfile entry, or a freshly resolved wildcard or `latest`) — the system SHALL consult the cache for that version before downloading, and SHALL use the cached content on a hit.

#### Scenario: First fetch populates the cache

- **WHEN** the system installs a facet whose exact version is not present in the cache
- **THEN** the system SHALL fetch the facet's content
- **AND** the system SHALL verify the content's integrity
- **AND** the system SHALL store the verified content in the cache keyed by the exact version

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

The system SHALL provide a frozen-lockfile mode for install in which the lockfile is treated as the source of truth and reproduced exactly: no extra facets, no missing facets, no source changes, and no content changes. In this mode the system SHALL NOT perform version resolution for any facet and SHALL NOT write the lockfile; content download for a locked exact version absent from the cache SHALL remain permitted, because downloading already-locked bytes is reproduction, not drift. Because adding or removing a facet changes the locked set, the system SHALL reject a frozen-lockfile operation that carries any explicit add or removal, before inspecting the lockfile. Before installing, the system SHALL verify that the lockfile fully and consistently covers the manifest. The system SHALL fail without modifying the project if any of the following is true: the operation carries an explicit add or removal, no lockfile exists, the lockfile cannot be read or does not satisfy the published schema, the manifest declares a facet that has no lockfile entry, a lockfile entry's recorded version does not satisfy its manifest specifier, the lockfile pins a facet the manifest no longer declares (an orphaned entry that a non-frozen install would prune), or a git or local facet's manifest source string (URL, ref, or path) no longer matches the recorded git or local source provenance. When the lockfile fully covers the manifest, the system SHALL install exactly the versions and integrity hashes recorded in the lockfile, downloading any whose content is not cached, and SHALL verify that every facet — including cached content and local sources, which a non-frozen install would rebuild from disk — reproduces its recorded integrity, failing if any content does not match. Because frozen mode never creates a lockfile entry, it SHALL NOT require integrity confirmation against the registry; its only permitted network activity is downloading already-locked content.

Frozen mode constrains the locked set, not the machine's materialized state: assets that the receipt shows as materialized but that the lockfile-covered manifest no longer wants SHALL still be removed, and the receipt SHALL be updated to match — while the lockfile and manifest SHALL still never be written.

#### Scenario: Frozen install proceeds when the lockfile covers the manifest

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** every facet in the manifest has a lockfile entry whose version satisfies its manifest specifier
- **THEN** the system SHALL install exactly the versions and integrity hashes recorded in the lockfile
- **AND** the system SHALL NOT perform version resolution
- **AND** the system SHALL NOT write the lockfile

#### Scenario: Frozen mode downloads a locked version absent from the cache

- **WHEN** a user runs install in frozen-lockfile mode on a project whose lockfile covers the manifest
- **AND** a locked exact version's content is not present in the cache
- **THEN** the system SHALL download that exact version's content
- **AND** the system SHALL verify it against the recorded integrity
- **AND** the system SHALL NOT treat the download as drift

#### Scenario: Frozen mode verifies cached content against the locked integrity

- **WHEN** a user runs install in frozen-lockfile mode on a project whose lockfile covers the manifest
- **AND** a locked exact version's content is present in the cache but does not reproduce the lockfile's recorded integrity
- **THEN** the system SHALL fail with an integrity error before materializing that facet
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Frozen mode still cleans up a facet dropped by a pulled change

- **WHEN** a change pulled from version control removes a facet from both the manifest and the lockfile
- **AND** the receipt shows that facet's assets as materialized on this machine
- **AND** a user runs install in frozen-lockfile mode
- **THEN** the frozen consistency check SHALL pass (the manifest and lockfile agree)
- **AND** the system SHALL delete that facet's assets using the receipt
- **AND** the system SHALL update the receipt so it no longer lists the facet
- **AND** the system SHALL NOT write the lockfile or the manifest

#### Scenario: Frozen mode rejects an explicit add or removal

- **WHEN** a user invokes an add or removal in frozen-lockfile mode
- **THEN** the system SHALL fail immediately with an error stating that a frozen lockfile cannot be modified
- **AND** the system SHALL NOT inspect or resolve any facet
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Frozen install fails when no lockfile exists

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** no lockfile exists for the project
- **THEN** the system SHALL fail with an error stating the lockfile is missing
- **AND** the system SHALL NOT create or modify the lockfile

#### Scenario: Frozen install fails when a manifest facet is missing from the lockfile

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** the manifest declares a facet that has no entry in the lockfile
- **THEN** the system SHALL fail with an error identifying the uncovered facet
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Frozen install fails when the lockfile drifts from the manifest

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** a lockfile entry's recorded version does not satisfy its manifest specifier
- **THEN** the system SHALL fail with an error identifying each drifting facet, its manifest specifier, and its locked version
- **AND** the system SHALL NOT perform version resolution
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Frozen install fails on an orphaned lockfile entry

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** the lockfile pins a facet the manifest no longer declares
- **THEN** the system SHALL fail with an error identifying the orphaned facet and its locked version
- **AND** the system SHALL NOT prune the orphaned facet's assets
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Frozen install fails when a git or local source changed

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** a git or local facet's manifest source string (URL, ref, or path) differs from the locked source
- **THEN** the system SHALL fail with an error identifying the facet, its manifest source, and its locked source
- **AND** the system SHALL NOT clone, resolve, or build from the changed source
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Frozen install fails when local source content drifted

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** a local facet's source path is unchanged but its on-disk content no longer reproduces the locked integrity
- **THEN** the system SHALL fail with an integrity error rather than rebuilding and overwriting the entry
- **AND** the system SHALL leave the manifest, lockfile, and on-disk adapter state unchanged

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

### Requirement: Removing a facet uninstalls it

When a user removes a facet from a project, the system SHALL drop the facet from the project manifest, delete the facet's materialized assets from every selected adapter, and update the lockfile and the receipt so neither records the facet — all in a single operation. A user SHALL NOT need to run a separate install step after removing. The asset set to delete SHALL be taken from the receipt, so removal SHALL require neither the cache nor the network.

#### Scenario: Removing a declared facet uninstalls it

- **WHEN** a user removes a facet that is declared in the project manifest
- **THEN** the system SHALL remove the facet's entry from the project manifest
- **AND** the system SHALL delete every asset the facet contributed from every selected adapter, using the asset set recorded in the receipt
- **AND** the system SHALL update the lockfile and the receipt so neither records the facet
- **AND** the operation SHALL complete in a single command invocation

#### Scenario: Other facets are left intact

- **WHEN** a user removes one facet from a project that declares several facets
- **THEN** the system SHALL leave every other declared facet's manifest entry, lockfile entry, receipt entry, and materialized assets unchanged

#### Scenario: Removing the last facet leaves an empty project

- **WHEN** a user removes the only facet declared in the project
- **THEN** the system SHALL leave the project manifest declaring no facets
- **AND** the system SHALL leave a valid lockfile that records no facets

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

When a user removes a facet that is not declared in the project manifest, the system SHALL silently ignore the name. The project manifest, lockfile, receipt, and adapter state SHALL remain unchanged for that name. When every requested name is undeclared, the system SHALL exit successfully and SHALL report that no changes were made.

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
