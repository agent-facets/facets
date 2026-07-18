## MODIFIED Requirements

### Requirement: A single archive-verification operation produces a structured result for any consumer of a built `.facet`

A facet-compatible system SHALL expose, on its protocol surface, a single archive-verification operation that takes the bytes of a built `.facet` and produces a structured result indicating whether the archive is a valid, self-consistent facet artifact. The operation SHALL perform the full chain of checks required to treat the archive as trusted: it SHALL parse the outer container into its two declared entries, decompress the inner archive, verify that the recomputed inner-archive content hash equals the integrity value recorded in the build manifest, verify that the per-asset hashes recorded in the build manifest each equal the actual hash of the corresponding file inside the inner archive, validate the embedded facet manifest against the manifest schema, and apply the artifact content rules (no empty declared assets, no naming collisions within an asset type, and no name shared between a skill and a command). The operation SHALL return a structured pass-or-fail result and SHALL NOT throw on any of these failure modes; failures SHALL be surfaced as data the caller can render or branch on.

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

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose inner content violates the artifact content rules — for example, a declared asset file that is empty, two assets sharing the same name within an asset type, or a skill and a command sharing the same name
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
