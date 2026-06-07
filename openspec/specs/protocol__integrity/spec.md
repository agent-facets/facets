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

An integrity failure SHALL be returned as structured data identifying the failing check, the expected and observed integrity values, the artifact name, and (where relevant) the asset path. Integrity failures SHALL NOT be returned as opaque error messages or raw exceptions.

#### Scenario: A facet-level failure is structured

- **WHEN** any facet-level integrity check fails (lockfile, cache hit, archive-vs-metadata, content-vs-archive, or git lockfile-vs-built)
- **THEN** the failure SHALL be returned as structured data identifying the check that failed
- **AND** the failure SHALL include the facet name, the expected integrity value, and the observed integrity value

#### Scenario: An asset-level failure is structured

- **WHEN** a per-asset hash recorded in the build manifest does not match the corresponding asset's locally-computed hash
- **THEN** the failure SHALL be returned as structured data identifying the asset path
- **AND** the failure SHALL include the facet name, the asset path, the expected hash, and the observed hash

### Requirement: A single archive-verification operation produces a structured result for any consumer of a built `.facet`

A facet-compatible system SHALL expose, on its protocol surface, a single archive-verification operation that takes the bytes of a built `.facet` and produces a structured result indicating whether the archive is a valid, self-consistent facet artifact. The operation SHALL perform the full chain of checks required to treat the archive as trusted: it SHALL parse the outer container into its two declared entries, decompress the inner archive, verify that the recomputed inner-archive content hash equals the integrity value recorded in the build manifest, verify that the per-asset hashes recorded in the build manifest each equal the actual hash of the corresponding file inside the inner archive, validate the embedded facet manifest against the manifest schema, and apply the artifact content rules (no empty declared assets, no naming collisions within an asset type). The operation SHALL return a structured pass-or-fail result and SHALL NOT throw on any of these failure modes; failures SHALL be surfaced as data the caller can render or branch on.

The operation SHALL be the single, shared mechanism by which any facet-compatible system verifies a built archive before treating it as trusted. A system SHALL NOT reimplement the verification chain by stringing together lower-level primitives in a way that allows the implementation to drift from the one specified here.

Decompression is not part of the protocol surface — the protocol does not perform compression or decompression. The archive-verification operation SHALL accept a caller-supplied decompressor as an input parameter and SHALL use it to decompress the inner archive. The operation SHALL NOT itself decompress, gzip, or perform any ambient input or output. The caller-supplied decompressor SHALL be permitted, but SHALL NOT be required, to enforce a maximum decompressed size; the verification result's failure surface SHALL include a way to report that the decompressor refused to decompress an inner archive whose decompressed size exceeded the caller's allowance.

#### Scenario: A self-consistent built archive verifies as valid

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose build manifest's integrity hash matches the recomputed inner-archive content hash, whose build manifest's per-asset hash map matches every actual per-asset hash inside the inner archive, whose embedded facet manifest is schema-valid, and whose inner content satisfies the artifact content rules
- **THEN** the operation SHALL produce a successful result
- **AND** the successful result SHALL carry the parsed build manifest and per-asset information needed by the caller

#### Scenario: A tampered inner archive is rejected

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose inner-archive content has been modified after the build manifest was written, so that the recomputed inner-archive content hash no longer equals the build manifest's recorded integrity value
- **THEN** the operation SHALL produce a failure result identifying the integrity mismatch as the reason
- **AND** the operation SHALL NOT throw

#### Scenario: A per-asset hash mismatch is rejected

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` in which one or more individual asset files inside the inner archive do not hash to the value recorded for that asset in the build manifest's per-asset hash map
- **THEN** the operation SHALL produce a failure result identifying which assets failed and the expected and observed hashes
- **AND** the operation SHALL NOT throw

#### Scenario: An invalid embedded facet manifest is rejected

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose embedded facet manifest does not satisfy the manifest schema
- **THEN** the operation SHALL produce a failure result identifying the embedded manifest as invalid
- **AND** the operation SHALL NOT throw

#### Scenario: A content rule violation in the inner archive is rejected

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose inner content violates the artifact content rules — for example, a declared asset file that is empty, or two assets sharing the same name within an asset type
- **THEN** the operation SHALL produce a failure result identifying the content violation
- **AND** the operation SHALL NOT throw

#### Scenario: A caller-supplied decompressor refuses to decompress

- **WHEN** a caller invokes the archive-verification operation with a decompressor that refuses to decompress an inner archive whose decompressed size exceeds the caller's allowance
- **THEN** the operation SHALL produce a failure result indicating that the decompressor refused
- **AND** the operation SHALL NOT throw

#### Scenario: A malformed outer container is rejected

- **WHEN** a caller invokes the archive-verification operation with bytes that cannot be parsed as the canonical two-entry outer container
- **THEN** the operation SHALL produce a failure result identifying the malformed container
- **AND** the operation SHALL NOT throw
