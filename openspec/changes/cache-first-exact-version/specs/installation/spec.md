## ADDED Requirements

### Requirement: Version resolution, content download, and integrity confirmation are distinct network operations

The system performs three distinct network operations when installing a registry facet, and SHALL gate them independently:

- **Version resolution** — determining the exact version a specifier refers to (turning a bare name, `latest`, `*`, or a bounded wildcard such as `1.*` into a concrete `MAJOR.MINOR.PATCH`). The system SHALL perform version resolution only when an exact version is not already known.
- **Content download** — retrieving the archive bytes for an exact `name@version`. The system SHALL perform content download only when that exact version is not already present in the local cache.
- **Integrity confirmation** — verifying that the content about to be installed matches the integrity the registry publishes for that exact `name@version`. The system SHALL perform integrity confirmation whenever it records a lockfile entry for a registry facet that no existing satisfying lockfile entry already anchors, and SHALL NOT record such an entry without it. A satisfying lockfile entry SHALL serve as the trust anchor instead, requiring no confirmation.

An exact version that is already cached SHALL require neither version resolution nor content download. A request whose exact version is already known (an exact specifier, or a satisfying lockfile entry) SHALL NOT trigger version resolution. The presence of a cached copy SHALL NOT, by itself, avoid version resolution when the exact version is not yet known, and SHALL NOT avoid integrity confirmation when a lockfile entry is being created.

#### Scenario: Exact specifier with warm cache and satisfying lockfile entry contacts the network for nothing

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

When a user explicitly adds a facet, the system SHALL treat that request as authoritative and SHALL NOT consult the lockfile to satisfy it. The system SHALL distinguish a facet the user is **explicitly adding** from a facet **already recorded in the manifest** that is merely being reproduced, and SHALL trust the lockfile only for the latter.

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

The system SHALL maintain a machine-local record of what it has materialized into each project's adapter trees, separate from the lockfile. Because the lockfile is shared and version-controlled, it cannot reliably describe what a particular machine has on disk — a change pulled from version control can remove a lockfile entry while that facet's assets remain materialized in the working copy. The machine-local record SHALL persist outside the project's version-controlled files and SHALL survive operations that rewrite the lockfile from outside the system. Each project SHALL have its own record, identified by the project's canonical on-disk location, so that two distinct projects never share a record and concurrent operations in different projects never contend on one. For each materialized facet the record SHALL retain enough information — at minimum the asset set it contributed — to remove that facet's assets later without consulting the cache or the network. A project that has no such record yet SHALL have one created from the current lockfile on the next operation.

The system SHALL treat this record, not the on-disk lockfile, as the description of what is currently materialized when deciding which assets to remove. When a facet is recorded as materialized but is no longer wanted (absent from the manifest and not being added), the system SHALL delete that facet's recorded assets from every selected adapter and SHALL drop the facet from both the lockfile and the machine-local record. This removal SHALL succeed without any network access and without any cached content, because the record itself carries the asset set to delete.

The record SHALL be treated as untrusted input. Before acting on a record, the system SHALL verify it corresponds to the project being operated on; a record that does not (corruption, collision, or tampering) SHALL be ignored and recreated rather than acted upon. When deleting assets named by the record, the system SHALL delete only files that resolve to locations inside the project's adapter trees; a recorded path that resolves outside them SHALL NOT be deleted, and the system SHALL report it. A corrupted record MAY cause a cleanup to be skipped; it SHALL NOT cause deletion outside the project's adapter trees.

#### Scenario: A pulled change that drops a lockfile entry still cleans up its assets

- **WHEN** a change pulled from version control removes a facet from both the manifest and the lockfile
- **AND** that facet's assets were previously materialized on this machine
- **AND** the user runs install
- **THEN** the system SHALL detect the facet as materialized but no longer wanted via the machine-local record
- **AND** the system SHALL delete that facet's assets from every selected adapter
- **AND** the system SHALL NOT leave the facet's assets orphaned on disk

#### Scenario: Removal needs neither cache nor network

- **WHEN** a user removes a facet whose content is absent from the cache and whose registry is unreachable
- **THEN** the system SHALL still delete that facet's assets using the asset set recorded in the machine-local record
- **AND** the removal SHALL succeed

#### Scenario: A project without a record bootstraps one

- **WHEN** the system operates on a project that has a lockfile but no machine-local record yet
- **THEN** the system SHALL create the record from the current lockfile's entries
- **AND** subsequent operations SHALL use the record as the description of what is materialized

#### Scenario: A record naming a path outside the project never causes deletion there

- **WHEN** the machine-local record contains an asset path that resolves outside the project's adapter trees (for example via `..` segments, an absolute path elsewhere, or a symlink)
- **AND** the system would otherwise remove that facet's assets
- **THEN** the system SHALL NOT delete the escaping path
- **AND** the system SHALL report the invalid entry
- **AND** valid asset paths inside the adapter trees SHALL still be processed normally

#### Scenario: A record that does not match its project is ignored, not acted on

- **WHEN** the system loads a machine-local record whose recorded project identity does not match the project being operated on
- **THEN** the system SHALL NOT delete any assets based on that record
- **AND** the system SHALL recreate the record from the current lockfile as if none existed

## MODIFIED Requirements

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

### Requirement: Frozen-lockfile install treats the lockfile as authoritative

The system SHALL provide a frozen-lockfile mode for install in which the lockfile is treated as the source of truth and reproduced exactly: no extra facets, no missing facets, no source changes, and no content changes. In this mode the system SHALL NOT perform version resolution for any facet and SHALL NOT write the lockfile; content download for a locked exact version absent from the cache SHALL remain permitted, because downloading already-locked bytes is reproduction, not drift. Because adding or removing a facet changes the locked set, the system SHALL reject a frozen-lockfile operation that carries any explicit add or removal, before inspecting the lockfile. Before installing, the system SHALL verify that the lockfile fully and consistently covers the manifest. The system SHALL fail without modifying the project if any of the following is true: the operation carries an explicit add or removal, no lockfile exists, the lockfile cannot be read or does not satisfy the published schema, the manifest declares a facet that has no lockfile entry, a lockfile entry's recorded version does not satisfy its manifest specifier, the lockfile pins a facet the manifest no longer declares (an orphaned entry that a non-frozen install would prune), or a git or local facet's manifest source string (URL, ref, or path) no longer matches the recorded git or local source provenance. When the lockfile fully covers the manifest, the system SHALL install exactly the versions and integrity hashes recorded in the lockfile, downloading any whose content is not cached, and SHALL verify that every facet — including cached content and local sources, which a non-frozen install would rebuild from disk — reproduces its recorded integrity, failing if any content does not match. Because frozen mode never creates a lockfile entry, it SHALL NOT require integrity confirmation against the registry; its only permitted network activity is downloading already-locked content.

Frozen mode constrains the locked set, not the machine's materialized state: assets that the machine-local record shows as materialized but that the lockfile-covered manifest no longer wants SHALL still be removed, and the machine-local record SHALL be updated to match — while the lockfile and manifest SHALL still never be written.

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
- **AND** the machine-local record shows that facet's assets as materialized on this machine
- **AND** a user runs install in frozen-lockfile mode
- **THEN** the frozen consistency check SHALL pass (the manifest and lockfile agree)
- **AND** the system SHALL delete that facet's assets using the machine-local record
- **AND** the system SHALL update the machine-local record so it no longer lists the facet
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

### Requirement: Failed installs leave the project unchanged

The project manifest, the lockfile, and the machine-local install record SHALL be written together as a single transactional commit at the end of a successful operation. The system SHALL NOT write the manifest ahead of resolving and materializing a change. When an install, add, or remove operation fails for any reason, the manifest, the lockfile, and the install record on disk SHALL all remain exactly as they were before the operation. The user SHALL NOT be left with a project whose manifest references a facet that was never installed, nor with a lockfile or install record that records a state that was never materialized.

#### Scenario: Add failure leaves manifest, lockfile, and install record unchanged

- **WHEN** a user adds a facet
- **AND** any step (resolution, download, integrity, materialization, or the final write) fails
- **THEN** the manifest on disk SHALL match its pre-operation contents
- **AND** the lockfile on disk SHALL match its pre-operation contents
- **AND** the machine-local install record on disk SHALL match its pre-operation contents
- **AND** the system SHALL surface the failure to the user

#### Scenario: Manifest, lockfile, and install record are written together on success

- **WHEN** an add, remove, or install operation succeeds
- **THEN** the system SHALL write the updated manifest, lockfile, and install record as one commit
- **AND** no one of the three files SHALL be left written while another is not

### Requirement: Removing a facet uninstalls it

When a user removes a facet from a project, the system SHALL drop the facet from the project manifest, delete the facet's materialized assets from every selected adapter, and update the lockfile and the machine-local install record so neither records the facet — all in a single operation. A user SHALL NOT need to run a separate install step after removing. The asset set to delete SHALL be taken from the machine-local install record, so removal SHALL require neither the cache nor the network.

#### Scenario: Removing a declared facet uninstalls it

- **WHEN** a user removes a facet that is declared in the project manifest
- **THEN** the system SHALL remove the facet's entry from the project manifest
- **AND** the system SHALL delete every asset the facet contributed from every selected adapter, using the asset set recorded in the machine-local install record
- **AND** the system SHALL update the lockfile and the machine-local install record so neither records the facet
- **AND** the operation SHALL complete in a single command invocation

#### Scenario: Other facets are left intact

- **WHEN** a user removes one facet from a project that declares several facets
- **THEN** the system SHALL leave every other declared facet's manifest entry, lockfile entry, install-record entry, and materialized assets unchanged

#### Scenario: Removing the last facet leaves an empty project

- **WHEN** a user removes the only facet declared in the project
- **THEN** the system SHALL leave the project manifest declaring no facets
- **AND** the system SHALL leave a valid lockfile that records no facets
