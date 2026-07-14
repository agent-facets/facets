## MODIFIED Requirements

### Requirement: Content hashes are computed for individual text assets

The system SHALL compute a SHA-256 content hash for every inner-archive entry: the facet manifest, each resolved primary asset, and each declared supplementary file. The facet manifest's hash SHALL use the exact bytes of the embedded `facet.json` archive entry — the source manifest file verbatim, with no re-serialization or canonicalization. A primary text asset's hash SHALL use its resolved string content encoded as UTF-8. A supplementary file's hash SHALL use its exact bytes without front-matter processing, line-ending normalization, or text decoding; empty and binary supplementary files SHALL be hashable. Every hash SHALL use the format `sha256:<hex-encoded hash>`.

#### Scenario: Per-entry hashes are computed during build

- **WHEN** a facet is built with two skills, one agent, a root `README.md`, and a skill companion
- **THEN** the build output SHALL include a content hash for the facet manifest and every primary and supplementary entry
- **AND** each hash SHALL be in `sha256:<hex>` format

#### Scenario: Identical content produces identical hashes

- **WHEN** two entries contain identical bytes
- **THEN** their content hashes SHALL be identical

#### Scenario: Any content change produces a different hash

- **WHEN** an entry's content changes by one byte
- **THEN** its content hash SHALL differ from the previous hash

#### Scenario: Empty supplementary file is hashed

- **WHEN** a declared supplementary file contains zero bytes
- **THEN** the build SHALL record the SHA-256 hash of the empty byte sequence

### Requirement: Build output is assembled into a compressed archive

The system SHALL assemble all resolved build output into a two-layer archive file with the extension `.facet`. The outer layer SHALL be an uncompressed tar containing exactly `build-manifest.json` and `archive.tar.gz`. The inner `archive.tar.gz` SHALL be a gzip-compressed tar containing the facet manifest, all resolved primary asset files, and every declared supplementary file at its canonical path. Every inner entry SHALL be derivable from the embedded facet manifest; undeclared source-tree files SHALL NOT be packaged. The archive filename SHALL follow `<name>-<version>.facet`, using the facet manifest's name and version.

Before replacing previous build output, the system SHALL validate every declared source path. A missing declaration target, unsafe or non-canonical path, non-regular file, or collision SHALL produce structured failure data and SHALL leave previous build output unchanged.

#### Scenario: Successful build produces a self-contained facet archive

- **WHEN** a facet named `example-facet` at version `1.0.0` is built successfully
- **THEN** the system SHALL write `dist/example-facet-1.0.0.facet`
- **AND** its outer tar SHALL contain exactly `build-manifest.json` and `archive.tar.gz`

#### Scenario: Inner archive contains all declared entries

- **WHEN** a facet declares skill `review` with companion `references/api.md` and top-level `README.md`
- **THEN** the inner archive SHALL contain `facet.json`, `skills/review/SKILL.md`, `skills/review/references/api.md`, and `README.md`

#### Scenario: Undeclared source files are not packaged

- **WHEN** a source tree contains `notes.txt` that is neither a primary asset nor declared in `files`
- **THEN** the inner archive SHALL NOT contain `notes.txt`

#### Scenario: Missing declaration target preserves previous output

- **WHEN** a declared supplementary file is missing and `dist/` contains a previous successful build
- **THEN** the build SHALL fail with structured data identifying the missing path
- **AND** the previous `dist/` contents SHALL remain unchanged

#### Scenario: Non-regular supplementary source is rejected

- **WHEN** a supplementary declaration resolves through a symbolic link or hard link
- **THEN** the build SHALL fail before writing output

#### Scenario: Inner archive name is fixed

- **WHEN** any facet is built, regardless of name or version
- **THEN** the inner archive entry SHALL be named `archive.tar.gz`

### Requirement: An integrity hash is computed for the uncompressed tar archive

The system SHALL compute a SHA-256 content hash of the complete uncompressed inner-tar bytes before compression. The hash SHALL therefore cover the embedded facet manifest, every primary asset, every supplementary file, and canonical entry metadata. The inner tar SHALL use the canonical serialization: entries sorted lexicographically by path and every entry carrying the fixed deterministic metadata values (zeroed timestamps and ownership, fixed mode, empty user and group names), so independent producers reproduce identical tar bytes and identical integrity values for identical logical content. The hash format SHALL be `sha256:<hex-encoded hash>`. Compression SHALL remain a delivery concern so verification is independent of the gzip implementation.

#### Scenario: Integrity hash is computed from uncompressed tar bytes

- **WHEN** a facet is built successfully
- **THEN** the system SHALL compute the SHA-256 hash of the uncompressed inner-tar bytes before gzip compression
- **AND** the hash SHALL be in `sha256:<hex>` format

#### Scenario: Integrity hash changes when any entry changes

- **WHEN** any primary or supplementary entry changes
- **THEN** the integrity hash SHALL differ from the previous build's integrity hash

#### Scenario: Integrity verification is independent of the gzip implementation

- **WHEN** a consumer decompresses an inner archive using any compatible gzip implementation and hashes the resulting tar bytes
- **THEN** the computed hash SHALL match the integrity declared in the build manifest

#### Scenario: Independent builders reproduce identical integrity

- **WHEN** two facet-compatible systems build the same facet from identical sources, including supplementary files
- **THEN** the canonical serialization SHALL yield byte-identical uncompressed inner-tar bytes
- **AND** both systems SHALL compute the same integrity hash

### Requirement: A build manifest records content hashes

The system SHALL produce `build-manifest.json` in the outer tar of every `.facet` archive. Every newly produced build manifest SHALL declare numeric `facetVersion: 0.2`, `archive: "archive.tar.gz"`, the inner-archive `integrity`, and a `files` object mapping every canonical inner-archive path to its content hash. This current shape SHALL be emitted for asset-only facets and facets with supplementary files alike. New producers SHALL NOT emit `0.1` or an `assets` map; `0.1` remains a legacy consumer input during the compatibility window. The build manifest SHALL be a flat JSON object.

#### Scenario: Current build manifest is embedded in the facet archive

- **WHEN** a facet is built successfully
- **THEN** the outer tar SHALL contain `build-manifest.json`
- **AND** the manifest SHALL declare `facetVersion: 0.2`, `archive: "archive.tar.gz"`, `integrity`, and `files`

#### Scenario: Asset-only facet still emits current format

- **WHEN** a facet with no supplementary declarations is built
- **THEN** its build manifest SHALL declare `facetVersion: 0.2`
- **AND** its `files` map SHALL include `facet.json` and every primary asset

#### Scenario: Build manifest integrity matches inner archive

- **WHEN** a consumer decompresses `archive.tar.gz` and hashes the uncompressed tar bytes
- **THEN** the computed hash SHALL match the build manifest's `integrity`

#### Scenario: Build manifest file hashes match every entry

- **WHEN** a consumer hashes each individual inner-archive entry
- **THEN** every computed hash SHALL match the corresponding value in `files`

#### Scenario: Build manifest is readable without inner decompression

- **WHEN** a consumer parses the outer tar
- **THEN** the consumer SHALL be able to read `build-manifest.json` without decompressing `archive.tar.gz`

### Requirement: Build output contains the self-contained archive

After successful input validation, the `dist/` directory SHALL contain the `.facet` archive. By default, `dist/` SHALL contain only that archive. With `--emit-manifest`, the system SHALL also write a loose `build-manifest.json` identical to the embedded copy. The system SHALL NOT write loose manifest, asset, or supplementary source files to `dist/`. Previous build output SHALL be removed only after all source input validation succeeds.

#### Scenario: dist contains one file by default

- **WHEN** a facet builds successfully without `--emit-manifest`
- **THEN** `dist/` SHALL contain exactly the `.facet` archive

#### Scenario: dist contains two files with emit manifest

- **WHEN** a facet builds successfully with `--emit-manifest`
- **THEN** `dist/` SHALL contain the `.facet` archive and `build-manifest.json`
- **AND** the loose manifest SHALL be identical to the embedded manifest

#### Scenario: Valid rebuild cleans previous output

- **WHEN** all source inputs validate and `dist/` contains output from an older build
- **THEN** the system SHALL remove the previous output before writing the new output

#### Scenario: Invalid rebuild preserves previous output

- **WHEN** source input validation fails and `dist/` contains output from an older build
- **THEN** the previous output SHALL remain unchanged

### Requirement: Integrity hash information is displayed in build output

After a successful build, the system SHALL display the emitted `facetVersion`, the integrity hash, and the complete inner-archive entry listing, including supplementary files. The build progress display SHALL show archive assembly as a visible stage. The persistent plain-text summary SHALL include the integrity hash.

#### Scenario: Build displays format, integrity, and entries

- **WHEN** a facet with a declared `README.md` builds successfully
- **THEN** the system SHALL display `facetVersion: 0.2`, the `sha256:<hex>` integrity, and an entry listing containing `README.md`

#### Scenario: Stdout summary includes integrity hash

- **WHEN** a facet named `my-facet` at version `1.0.0` builds successfully
- **THEN** the stdout summary SHALL include its name, version, entry count, and a truncated integrity hash

#### Scenario: Build progress shows archive assembly stage

- **WHEN** a facet build is in progress
- **THEN** the progress display SHALL show archive assembly alongside validation and output stages
