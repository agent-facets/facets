## Purpose

Defines the integrity verification algorithm a facet-compatible system uses before treating an artifact as trusted. Covers the three-check protocol for registry sources, the one-check protocol for git sources, and the structured-failure shape that surfaces verification results.
## Requirements
### Requirement: Integrity verification SHALL precede any trust decision

A facet-compatible system SHALL verify a facet artifact's integrity before treating its contents as trusted. Integrity SHALL be verified by checking that the integrity hash declared in the artifact's build manifest equals the hash recomputed from the artifact's actual contents. A system SHALL NOT install, distribute, cache, or otherwise act on an artifact's contents until integrity verification has succeeded.

#### Scenario: Verification precedes installation

- **WHEN** a system fetches a facet artifact for installation
- **THEN** the system SHALL verify integrity before writing any of the artifact's contents to disk
- **AND** if verification fails, no part of the artifact SHALL be installed

#### Scenario: Verification precedes caching

- **WHEN** a system fetches a facet artifact intended for a local cache
- **THEN** the system SHALL verify integrity before treating the cached copy as authoritative
- **AND** if verification fails, the cache SHALL NOT retain the artifact

#### Scenario: A registry server verifies uploaded artifacts before storing them

- **WHEN** a registry receives an uploaded `.facet` artifact
- **THEN** the registry SHALL verify integrity before persisting the artifact in its store
- **AND** if verification fails, the upload SHALL be rejected with a structured error

### Requirement: A registry source uses three integrity checks

When a facet artifact is fetched from a registry source, the system SHALL run a three-check protocol against three integrity values: the registry's metadata-declared integrity, the artifact's self-declared integrity (from the embedded build manifest), and the integrity computed locally from the artifact's contents. The system SHALL also incorporate a fourth check against the lockfile's recorded integrity when a lockfile exists.

The checks SHALL run in the following order:
1. **Lockfile check** (if a lockfile exists for the requested name and version): the registry's declared integrity SHALL match the lockfile's recorded integrity. Failure indicates the registry has retroactively redefined what a pinned version should hash to.
2. **Cache-hit short-circuit** (if the artifact is already cached): the cache's recorded integrity SHALL match the registry's declared integrity. On match, no further checks are required.
3. **Cache-miss path B**: the artifact's self-declared integrity (build manifest) SHALL match the registry's declared integrity. Failure indicates a metadata-vs-archive split-brain.
4. **Cache-miss path C**: the locally-computed integrity SHALL match the artifact's self-declared integrity. Failure indicates a tampered artifact whose self-declared integrity is intact.

The first failing check SHALL halt the protocol and produce a structured failure identifying which check failed.

#### Scenario: All three checks pass on a cache miss

- **WHEN** a system fetches a registry-sourced facet that is not in the local cache
- **AND** the lockfile-declared, registry-declared, archive-declared, and locally-computed integrity values all agree
- **THEN** the system SHALL accept the artifact as trusted
- **AND** the system SHALL proceed with installation

#### Scenario: Lockfile check fails

- **WHEN** the registry's declared integrity for a pinned version differs from the lockfile's recorded integrity
- **THEN** the system SHALL halt the protocol with a structured failure naming the lockfile check
- **AND** the failure SHALL include both the expected and observed integrity values

#### Scenario: Cache hit short-circuits remaining checks

- **WHEN** a system fetches a registry-sourced facet whose cached integrity matches the registry's declared integrity
- **THEN** the system SHALL accept the cached artifact as trusted
- **AND** the system SHALL NOT recompute the artifact's integrity from cache contents

#### Scenario: Path B fails

- **WHEN** the artifact's self-declared integrity differs from the registry's declared integrity
- **THEN** the system SHALL halt the protocol with a structured failure naming check B
- **AND** the failure SHALL identify the metadata-vs-archive divergence

#### Scenario: Path C fails

- **WHEN** the locally-computed integrity differs from the artifact's self-declared integrity
- **THEN** the system SHALL halt the protocol with a structured failure naming check C
- **AND** the failure SHALL indicate that the artifact has been tampered with

### Requirement: A git source uses one integrity check

When a facet artifact is built locally from a git source, the system SHALL verify integrity by checking that the locally-built artifact's integrity matches the integrity recorded in the lockfile for the resolved git commit. This check detects tag-move attacks where a symbolic reference (branch or tag) now resolves to a different commit than was previously locked.

#### Scenario: The locally-built integrity matches the lockfile

- **WHEN** a system clones a git source, builds it locally, and computes the resulting integrity
- **AND** the computed integrity matches the lockfile's recorded integrity
- **THEN** the system SHALL accept the locally-built artifact as trusted

#### Scenario: Tag-move attack is detected

- **WHEN** a symbolic reference now resolves to a different commit than was previously locked
- **AND** the locally-built integrity differs from the lockfile's recorded integrity
- **THEN** the system SHALL halt the protocol with a structured failure
- **AND** the failure SHALL identify both the expected (lockfile) and observed (locally-built) integrity values

### Requirement: Integrity failures are structured data

An integrity failure SHALL be returned as structured data identifying the failing check, the expected and observed values when available, the facet name, and the exact canonical entry path when the failure concerns one file. Unsupported archive-format failures SHALL contain the observed version and supported versions. Integrity failures SHALL NOT be returned as opaque messages or raw exceptions.

#### Scenario: A facet-level failure is structured

- **WHEN** a facet-level integrity check fails
- **THEN** the failure SHALL identify the check, facet name, expected integrity, and observed integrity

#### Scenario: A per-entry failure is structured

- **WHEN** a recorded file hash differs from the recomputed hash of a primary or supplementary entry
- **THEN** the failure SHALL identify the facet and exact canonical entry path
- **AND** the failure SHALL include the expected and observed hashes

#### Scenario: Unsupported format failure is structured

- **WHEN** an archive declares an unsupported `facetVersion`
- **THEN** the failure SHALL contain the observed version and all supported versions

### Requirement: A single archive-verification operation produces a structured result for any consumer of a built `.facet`

A facet-compatible system SHALL expose one archive-verification operation that accepts built `.facet` bytes and returns structured success or failure data without throwing for expected validation failures. The operation SHALL parse the canonical two-entry outer container, select the archive schema by exact `facetVersion`, decompress the inner archive through a caller-supplied decompressor, verify the uncompressed archive integrity, validate the embedded facet manifest, verify manifest-derived archive membership, and verify every per-entry content hash.

Valid legacy `0.1` archives SHALL be verified under their exact legacy schema and content rules during the compatibility window. Current `0.2` archives SHALL be verified under current schema and content rules. Any other version SHALL return a structured unsupported-version failure, and a malformed archive SHALL NOT be retried under another version's rules.

Raw entry validation SHALL apply to both archive layers before any path-keyed selection. The outer container's entries SHALL be validated before either required entry is chosen: duplicate outer paths, portable-alias outer paths, and non-regular outer entries SHALL each be structured rejections rather than being collapsed by parser behavior. Before trusting inner entry contents, verification SHALL reject exact duplicate paths, portable-alias paths that collide by Unicode normalization or case folding, non-regular entries including links and directories, and unsafe, non-canonical, or non-portable paths (including Windows-reserved device-name segments, forbidden portable characters, and segments ending in a dot or space). The embedded facet manifest and the build manifest SHALL be rejected when their JSON documents contain duplicate object member names, before schema validation. The expected path set SHALL be derived from the embedded facet manifest's conventional primary paths and exact supplementary declarations rather than from the build manifest. The observed set, expected set, and `0.2` build manifest `files` key set SHALL be exactly equal. Verification SHALL reject both undeclared extra entries and declared-but-missing entries, then recompute and compare the hash of every expected entry.

A successful `0.2` result SHALL distinguish primary assets, companion files grouped with their owning skill, and archive-only supplementary files. Primary assets SHALL be exposed as text eligible for asset processing; supplementary content SHALL remain opaque bytes. Empty-content and front-matter rules SHALL apply to primary assets only. Current asset names and skill/command namespace collisions SHALL be validated under the current manifest rules; legacy archives SHALL retain their legacy naming rules.

The operation SHALL be the shared verification mechanism for consumers before an archive is trusted. Decompression SHALL remain caller-supplied and MAY enforce a caller-selected maximum decompressed size. A decompression refusal SHALL be represented as structured failure data. The operation SHALL NOT perform compression, decompression, or ambient input/output itself; it SHALL use the supplied decompressor for inner-archive decompression.

#### Scenario: A self-consistent current archive verifies as valid

- **WHEN** a caller verifies a `0.2` archive whose manifest declares `README.md` and `skills/review/references/api.md`, whose observed entries and `files` hashes exactly match those declarations, and whose integrity is valid
- **THEN** the operation SHALL return success
- **AND** the result SHALL distinguish the primary skill, its companion bytes, and the archive-only README bytes

#### Scenario: A valid legacy archive remains accepted

- **WHEN** a caller verifies a valid `0.1` archive during the compatibility window
- **THEN** the operation SHALL apply the legacy schema and rules and return success

#### Scenario: An unsupported version is rejected without fallback

- **WHEN** a caller verifies an archive declaring `facetVersion: 0.3`
- **THEN** the operation SHALL return structured failure data containing `0.3` and the supported versions
- **AND** the operation SHALL NOT reinterpret the archive as `0.1` or `0.2`

#### Scenario: A tampered inner archive is rejected

- **WHEN** inner-archive bytes no longer reproduce the build manifest's integrity
- **THEN** the operation SHALL return an integrity-mismatch failure
- **AND** the operation SHALL NOT throw

#### Scenario: A supplementary-file hash mismatch is rejected

- **WHEN** `skills/review/references/api.md` does not hash to its `files` value
- **THEN** the failure SHALL identify that exact path and the expected and observed hashes

#### Scenario: Undeclared inner entry is rejected

- **WHEN** a `0.2` inner archive contains `secret.txt` that is not derivable from the embedded manifest
- **THEN** the operation SHALL return structured failure data identifying `secret.txt` as undeclared

#### Scenario: Build-manifest-only entry cannot expand archive membership

- **WHEN** a `0.2` build manifest records `secret.txt` and the inner archive contains it, but the embedded facet manifest does not derive that path
- **THEN** verification SHALL reject `secret.txt` as undeclared
- **AND** the build-manifest record SHALL NOT legitimize the entry

#### Scenario: Declared but missing entry is rejected

- **WHEN** the embedded manifest declares `README.md` but the inner archive omits it
- **THEN** the operation SHALL return structured failure data identifying `README.md` as missing

#### Scenario: Duplicate inner paths are rejected

- **WHEN** the inner tar contains two entries with the same path
- **THEN** the operation SHALL reject the archive rather than silently selecting one entry

#### Scenario: Portable alias inner paths are rejected

- **WHEN** an inner tar contains paths that differ in spelling but collide by Unicode normalization or portable case folding
- **THEN** verification SHALL return structured failure data identifying both aliased paths
- **AND** it SHALL reject the archive before selecting either entry

#### Scenario: Non-regular inner entry is rejected

- **WHEN** the inner tar contains a symbolic link, hard link, directory, or device entry
- **THEN** the operation SHALL return a structured content failure

#### Scenario: Invalid embedded facet manifest is rejected

- **WHEN** an archive's embedded `facet.json` does not satisfy the schema for its version
- **THEN** the operation SHALL return a failure identifying the embedded manifest

#### Scenario: Current content rules distinguish primary and supplementary files

- **WHEN** a `0.2` archive contains an empty primary asset and an empty declared supplementary file
- **THEN** the operation SHALL reject the empty primary asset
- **AND** it SHALL NOT reject the supplementary file merely because it is empty

#### Scenario: Current skill and command collision is rejected

- **WHEN** a `0.2` embedded manifest declares both skill `review` and command `review`
- **THEN** the operation SHALL return a structured naming-collision failure identifying both declarations

#### Scenario: Caller-supplied decompressor refuses to decompress

- **WHEN** the supplied decompressor refuses because the inner archive exceeds the caller's allowance
- **THEN** the operation SHALL return structured decompression-refusal data
- **AND** the operation SHALL NOT throw

#### Scenario: Malformed outer container is rejected

- **WHEN** input bytes cannot be parsed as the canonical two-entry outer container
- **THEN** the operation SHALL return structured malformed-container data
- **AND** the operation SHALL NOT throw

#### Scenario: Duplicate outer entry is rejected

- **WHEN** the outer tar contains two entries named `build-manifest.json`, or a non-regular entry in place of a required outer entry
- **THEN** the operation SHALL return structured failure data before selecting either entry
- **AND** the operation SHALL NOT let parser collapse decide which entry is authoritative

#### Scenario: Duplicate JSON members are rejected

- **WHEN** the embedded `facet.json` or `build-manifest.json` contains the same object member name twice
- **THEN** the operation SHALL return a structured rejection before schema validation

#### Scenario: Non-portable inner path is rejected

- **WHEN** a `0.2` inner archive contains an entry whose path includes a Windows-reserved device-name segment such as `references/con`, a forbidden character such as `:`, or a segment ending in a dot or space
- **THEN** the operation SHALL return structured failure data identifying the non-portable path

