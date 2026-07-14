## MODIFIED Requirements

### Requirement: A single archive-verification operation produces a structured result for any consumer of a built `.facet`

A facet-compatible system SHALL expose, on its protocol surface, a single archive-verification operation that takes the bytes of a built `.facet` and produces a structured result indicating whether the archive is a valid, self-consistent facet artifact. The operation SHALL be the single, shared mechanism by which any facet-compatible system verifies a built archive before treating it as trusted. A system SHALL NOT reimplement the verification chain by stringing together lower-level primitives in a way that allows the implementation to drift from the one specified here.

The operation SHALL dispatch on the archive's declared format version exactly once: the legacy `0.1` archive format SHALL be verified under its original rules, the current `0.2` format SHALL be verified under the rules below, and any other declared version SHALL produce a structured unsupported-version failure carrying the observed version and the supported versions. A malformed archive of one declared version SHALL NOT be reinterpreted under another version's rules.

For a current-format archive the operation SHALL: parse the outer container into its two declared entries; decompress the inner archive; validate the raw inner entries **before** constructing any path-keyed collection, rejecting duplicate entry paths, non-regular entries (symlinks, hard links, directories, devices), and unsafe or non-canonical paths as distinct structured failures; validate the embedded facet manifest against the manifest schema; derive the complete expected entry set solely from the embedded facet manifest's declared assets and supplementary files; require the observed entry set to exactly equal the expected set; require the build manifest's per-entry hash map to have exactly one record per expected entry and no others; verify that the recomputed inner-archive content hash equals the integrity value recorded in the build manifest; verify every entry's bytes against its recorded hash; and apply the artifact content rules (no empty declared asset files, single-segment asset names, no name collisions within an asset type, no skill/command name collisions).

The operation SHALL return a structured pass-or-fail result and SHALL NOT throw on any of these failure modes; failures SHALL be surfaced as data the caller can render or branch on. The successful result SHALL distinguish, for each verified entry, whether it is the manifest, a primary asset file, a skill companion file (and which skill owns it), or an archive-only supplementary file, so that callers cannot confuse installable assets with files that merely travel in the archive.

Decompression is not part of the protocol surface — the protocol does not perform compression or decompression. The archive-verification operation SHALL accept a caller-supplied decompressor as an input parameter and SHALL use it to decompress the inner archive. The operation SHALL NOT itself decompress, gzip, or perform any ambient input or output. The caller-supplied decompressor SHALL be permitted, but SHALL NOT be required, to enforce a maximum decompressed size; the verification result's failure surface SHALL include a way to report that the decompressor refused to decompress an inner archive whose decompressed size exceeded the caller's allowance.

#### Scenario: A self-consistent built archive verifies as valid

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose build manifest's integrity hash matches the recomputed inner-archive content hash, whose per-entry hash map exactly matches the observed entries and their actual hashes, whose embedded facet manifest is schema-valid, whose entry set exactly equals the set derivable from the embedded manifest, and whose inner content satisfies the artifact content rules
- **THEN** the operation SHALL produce a successful result
- **AND** the successful result SHALL carry the parsed build manifest and the classification of every entry (manifest, primary asset, skill companion with its owning skill, or archive-only supplementary file)

#### Scenario: A tampered inner archive is rejected

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose inner-archive content has been modified after the build manifest was written, so that the recomputed inner-archive content hash no longer equals the build manifest's recorded integrity value
- **THEN** the operation SHALL produce a failure result identifying the integrity mismatch as the reason
- **AND** the operation SHALL NOT throw

#### Scenario: A per-entry hash mismatch is rejected

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` in which any entry — asset or supplementary file — does not hash to the value recorded for it in the build manifest
- **THEN** the operation SHALL produce a failure result identifying which entry paths failed and the expected and observed hashes
- **AND** the operation SHALL NOT throw

#### Scenario: Duplicate inner entry paths are rejected before any lossy collapse

- **WHEN** a caller invokes the archive-verification operation with a crafted archive containing two inner entries with the same path, or two paths that alias each other by Unicode normalization or case folding
- **THEN** the operation SHALL produce a failure result identifying the duplicate or aliased paths
- **AND** the later entry SHALL NOT silently replace the earlier one

#### Scenario: Non-regular inner entries are rejected

- **WHEN** a caller invokes the archive-verification operation with an archive containing a symlink, hard link, directory entry, or device entry in the inner archive
- **THEN** the operation SHALL produce a failure result identifying the non-regular entry
- **AND** the operation SHALL NOT throw

#### Scenario: Unsafe inner entry paths are rejected

- **WHEN** a caller invokes the archive-verification operation with an archive whose inner entries include a path containing `..` segments, an absolute path, a backslash, a NUL byte, or a drive prefix
- **THEN** the operation SHALL produce a failure result identifying the unsafe path
- **AND** the operation SHALL NOT throw

#### Scenario: An invalid embedded facet manifest is rejected

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose embedded facet manifest does not satisfy the manifest schema
- **THEN** the operation SHALL produce a failure result identifying the embedded manifest as invalid
- **AND** the operation SHALL NOT throw

#### Scenario: A content rule violation in the inner archive is rejected

- **WHEN** a caller invokes the archive-verification operation with the bytes of a built `.facet` whose inner content violates the artifact content rules — for example, a declared asset file that is empty, two assets sharing the same name within an asset type, or a skill and command sharing a name
- **THEN** the operation SHALL produce a failure result identifying the content violation
- **AND** the operation SHALL NOT throw

#### Scenario: An unsupported declared format version is rejected with a structured failure

- **WHEN** a caller invokes the archive-verification operation with an archive declaring a format version the system does not support
- **THEN** the operation SHALL produce a failure result carrying the observed version and the supported versions
- **AND** the operation SHALL NOT attempt to verify the archive under any other version's rules

#### Scenario: A caller-supplied decompressor refuses to decompress

- **WHEN** a caller invokes the archive-verification operation with a decompressor that refuses to decompress an inner archive whose decompressed size exceeds the caller's allowance
- **THEN** the operation SHALL produce a failure result indicating that the decompressor refused
- **AND** the operation SHALL NOT throw

#### Scenario: A malformed outer container is rejected

- **WHEN** a caller invokes the archive-verification operation with bytes that cannot be parsed as the canonical two-entry outer container
- **THEN** the operation SHALL produce a failure result identifying the malformed container
- **AND** the operation SHALL NOT throw

### Requirement: Integrity failures are structured data

An integrity failure SHALL be returned as structured data identifying the failing check, the expected and observed integrity values, the artifact name, and (where relevant) the entry path. Integrity failures SHALL NOT be returned as opaque error messages or raw exceptions. Entry-level failures SHALL identify the exact inner-archive path that failed, whether that path is an asset file or a supplementary file.

#### Scenario: A facet-level failure is structured

- **WHEN** any facet-level integrity check fails (lockfile, cache hit, archive-vs-metadata, content-vs-archive, or git lockfile-vs-built)
- **THEN** the failure SHALL be returned as structured data identifying the check that failed
- **AND** the failure SHALL include the facet name, the expected integrity value, and the observed integrity value

#### Scenario: An entry-level failure is structured

- **WHEN** a per-entry hash recorded in the build manifest does not match the corresponding entry's locally-computed hash — whether the entry is an asset file, a skill companion file, or an archive-only supplementary file
- **THEN** the failure SHALL be returned as structured data identifying the entry path
- **AND** the failure SHALL include the facet name, the entry path, the expected hash, and the observed hash

## ADDED Requirements

### Requirement: Every inner archive entry is derivable from the embedded manifest

For a current-format archive, the set of expected inner-archive entries SHALL be derived solely from the embedded facet manifest: the manifest itself, the conventional file paths of its declared assets, its declared skill companion files, and its declared archive-only supplementary files. Verification SHALL reject an archive whose observed entries include any path not in the derived set, and SHALL reject an archive missing any path in the derived set. The build manifest SHALL NOT be a source of membership: an entry listed only in the build manifest's hash map SHALL NOT make that entry expected.

#### Scenario: An undeclared extra entry is rejected

- **WHEN** an archive's inner entries include a file that is neither a conventional asset path nor a declared supplementary file of the embedded manifest
- **THEN** verification SHALL produce a failure result identifying the undeclared entry path
- **AND** the archive SHALL NOT be treated as trusted

#### Scenario: A declared entry missing from the archive is rejected

- **WHEN** the embedded manifest declares a supplementary file that is absent from the inner archive
- **THEN** verification SHALL produce a failure result identifying the missing declared path

#### Scenario: A build-manifest-only entry does not expand the expected set

- **WHEN** an archive's build manifest hash map records a path that the embedded facet manifest does not derive
- **AND** the inner archive contains an entry at that path
- **THEN** verification SHALL reject the archive
- **AND** the build manifest record SHALL NOT legitimize the undeclared entry

### Requirement: Legacy archives remain verifiable during the compatibility window

A system SHALL continue to verify legacy `0.1` archives under the rules that were published for that format, including its per-asset hash map and its asset-only entry set, for as long as the compatibility window remains open. Withdrawal of legacy verification SHALL be a separately published breaking change. A current-format archive that fails its own rules SHALL NOT be re-verified under legacy rules, and a legacy archive SHALL NOT be verified under current-format rules.

#### Scenario: A valid legacy archive verifies successfully

- **WHEN** a caller invokes the archive-verification operation with a valid legacy `0.1` archive produced before the current format existed
- **THEN** the operation SHALL produce a successful result under the legacy rules

#### Scenario: A legacy verifier rejects a current-format archive closed

- **WHEN** a system that supports only the legacy format receives a current-format archive containing supplementary files
- **THEN** the system SHALL reject the archive rather than partially install it
- **AND** the rejection is the correct fail-closed posture for a consumer that cannot enforce the current rules
