## ADDED Requirements

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

An integrity failure SHALL be returned as structured data identifying the failing check, the expected and observed integrity values, the artifact name, and (where relevant) the asset path. Integrity failures SHALL NOT be returned as opaque error messages or raw exceptions.

#### Scenario: A facet-level failure is structured

- **WHEN** any facet-level integrity check fails (lockfile, cache hit, archive-vs-metadata, content-vs-archive, or git lockfile-vs-built)
- **THEN** the failure SHALL be returned as structured data identifying the check that failed
- **AND** the failure SHALL include the facet name, the expected integrity value, and the observed integrity value

#### Scenario: An asset-level failure is structured

- **WHEN** a per-asset hash recorded in the build manifest does not match the corresponding asset's locally-computed hash
- **THEN** the failure SHALL be returned as structured data identifying the asset path
- **AND** the failure SHALL include the facet name, the asset path, the expected hash, and the observed hash
