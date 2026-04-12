## Purpose

Content hashing provides integrity guarantees for facet artifacts. At build time, the system computes SHA-256 content hashes at two levels — per-asset (for fine-grained change detection) and per-archive (for content integrity). The build assembles a deterministic tar archive, computes the integrity hash from the uncompressed tar bytes, compresses it for delivery, and records all hashes in a build manifest.

## Requirements

### Requirement: Content hashes are computed for individual text assets

The system SHALL compute a SHA-256 content hash for each resolved text asset (skills, agents, commands) and for the facet manifest. Each hash SHALL be computed from the file's resolved string content encoded as UTF-8. The hash format SHALL be `sha256:<hex-encoded hash>` (per [ADR-4](https://www.notion.so/exmachina-co/ADR-4)).

#### Scenario: Per-asset hashes computed during build

- **WHEN** a facet is built successfully with two skills and one agent
- **THEN** the build output SHALL include a content hash for each of the two skill files, the agent file, and the facet manifest
- **AND** each hash SHALL be in `sha256:<hex>` format

#### Scenario: Identical content produces identical hashes

- **WHEN** two assets contain identical resolved content
- **THEN** their content hashes SHALL be identical

#### Scenario: Any content change produces a different hash

- **WHEN** an asset's resolved content changes by even a single character
- **THEN** the content hash SHALL differ from the previous hash

### Requirement: Build output is assembled into a compressed archive

The system SHALL assemble all resolved build output into a two-layer archive file with the extension `.facet`. The outer layer SHALL be an uncompressed tar containing exactly two entries: `build-manifest.json` and `archive.tar.gz`. The inner `archive.tar.gz` SHALL be a gzip-compressed tar containing the facet manifest and all resolved text asset files. The archive filename SHALL follow the pattern `<name>-<version>.facet` where `name` and `version` come from the facet manifest.

#### Scenario: Successful build produces a self-contained .facet archive

- **WHEN** a facet named "example-facet" at version "1.0.0" is built successfully
- **THEN** the system SHALL write `dist/example-facet-1.0.0.facet`
- **AND** the `.facet` file SHALL be an uncompressed tar archive
- **AND** the tar SHALL contain exactly two entries: `build-manifest.json` and `archive.tar.gz`

#### Scenario: Inner archive contains all declared assets

- **WHEN** a facet with two skills, one agent, and one command is built
- **THEN** the `archive.tar.gz` entry within the `.facet` file SHALL be a gzip-compressed tar
- **AND** the inner tar SHALL contain the facet manifest, two skill files, the agent file, and the command file

#### Scenario: Inner archive does not contain extraneous files

- **WHEN** a facet is built
- **THEN** the inner `archive.tar.gz` SHALL contain only the facet manifest and resolved text assets
- **AND** the inner archive SHALL NOT contain the build manifest or any other metadata files

#### Scenario: Inner archive name is fixed

- **WHEN** any facet is built, regardless of name or version
- **THEN** the inner archive entry SHALL be named `archive.tar.gz`

### Requirement: Archive assembly is deterministic

The system SHALL produce identical archive bytes from identical inputs. Archive entries SHALL be sorted lexicographically by path. File metadata within the archive (timestamps, ownership, permissions) SHALL be set to fixed values so that they do not vary across builds or platforms.

#### Scenario: Rebuilding the same facet produces identical bytes

- **WHEN** a facet is built twice without changing any source files
- **THEN** the two archive files SHALL be byte-identical

#### Scenario: Build determinism is platform-independent

- **WHEN** the same facet source is built on different operating systems
- **THEN** the uncompressed tar archive SHALL be byte-identical
- **AND** the integrity hash SHALL be identical across platforms

#### Scenario: Archive entry ordering is stable

- **WHEN** a facet with assets named "b-agent", "a-skill", and "c-command" is built
- **THEN** the archive entries SHALL be sorted lexicographically by their path within the archive

### Requirement: An integrity hash is computed for the uncompressed tar archive

The system SHALL compute a SHA-256 content hash of the uncompressed tar archive bytes. The hash SHALL be computed from the deterministic tar before compression is applied. The hash format SHALL be `sha256:<hex-encoded hash>` (per [ADR-4](https://www.notion.so/exmachina-co/ADR-4)). This integrity hash is the primary integrity value for the artifact. Compression is a delivery concern — hashing the uncompressed tar ensures integrity verification is independent of the compression algorithm.

#### Scenario: Integrity hash is computed from uncompressed tar bytes

- **WHEN** a facet is built successfully
- **THEN** the system SHALL compute the SHA-256 hash of the uncompressed tar archive bytes (before gzip compression)
- **AND** the hash SHALL be in `sha256:<hex>` format

#### Scenario: Integrity hash changes when any asset changes

- **WHEN** any source asset's content changes
- **THEN** the integrity hash SHALL differ from the previous build's integrity hash

### Requirement: A build manifest records content hashes

The system SHALL produce a build manifest named `build-manifest.json` embedded inside the `.facet` archive as an entry in the outer tar. The manifest SHALL contain a `facetVersion` field set to `0.1` (number), an `archive` field set to `"archive.tar.gz"`, an `integrity` field with the integrity hash, and an `assets` object mapping relative paths to content hashes. The manifest SHALL be a flat JSON object.

#### Scenario: Build manifest is embedded in the .facet archive

- **WHEN** a facet is built successfully
- **THEN** the `.facet` file SHALL contain a `build-manifest.json` entry in the outer tar
- **AND** the manifest SHALL contain a `facetVersion` field set to `0.1`
- **AND** the manifest SHALL contain an `archive` field set to `"archive.tar.gz"`
- **AND** the manifest SHALL contain an `integrity` field with the integrity hash
- **AND** the manifest SHALL contain an `assets` object mapping relative paths to content hashes

#### Scenario: Build manifest integrity hash matches inner archive contents

- **WHEN** a consumer extracts `build-manifest.json` and `archive.tar.gz` from the `.facet` file, decompresses `archive.tar.gz`, and hashes the resulting tar bytes
- **THEN** the computed hash SHALL match the `integrity` value in the manifest

#### Scenario: Build manifest asset hashes match inner archive contents

- **WHEN** a consumer extracts `archive.tar.gz` from the `.facet` file, decompresses it, and hashes each individual file
- **THEN** each computed hash SHALL match the corresponding entry in the manifest's `assets` map

#### Scenario: Build manifest can be read without decompressing the inner archive

- **WHEN** a consumer parses the outer tar of a `.facet` file
- **THEN** the consumer SHALL be able to read `build-manifest.json` directly from the outer tar entries
- **AND** the consumer SHALL NOT need to decompress `archive.tar.gz` to access the manifest

### Requirement: Build output contains the self-contained archive

The `dist/` directory SHALL contain the `.facet` archive after a successful build. By default, `dist/` SHALL contain only the `.facet` file. When the `--emit-manifest` flag is passed to the build command, the system SHALL also write a loose copy of `build-manifest.json` to `dist/` alongside the archive. The system SHALL NOT write loose resolved asset files to `dist/`.

#### Scenario: dist/ contains one file by default

- **WHEN** a facet is built successfully without the `--emit-manifest` flag
- **THEN** `dist/` SHALL contain exactly the `.facet` archive file
- **AND** `dist/` SHALL NOT contain `build-manifest.json`
- **AND** `dist/` SHALL NOT contain loose facet manifest, `skills/`, `agents/`, or `commands/` files

#### Scenario: dist/ contains two files with --emit-manifest

- **WHEN** a facet is built successfully with the `--emit-manifest` flag
- **THEN** `dist/` SHALL contain the `.facet` archive file and `build-manifest.json`
- **AND** the loose `build-manifest.json` SHALL be identical in content to the one embedded in the `.facet` file

#### Scenario: Previous build output is cleaned

- **WHEN** a facet is rebuilt and the previous `dist/` directory contains files from an older build
- **THEN** the system SHALL remove the previous `dist/` contents before writing the new output

### Requirement: Integrity hash information is displayed in build output

The system SHALL display the integrity hash to the author after a successful build. The build progress display SHALL show the archive assembly as a visible stage. After completion, the system SHALL list the contents of the archive and display the integrity hash. The plain-text summary printed to stdout SHALL include the integrity hash.

#### Scenario: Build displays integrity hash on success

- **WHEN** a facet is built successfully
- **THEN** the system SHALL display the integrity hash in `sha256:<hex>` format
- **AND** the system SHALL list the files contained in the archive

#### Scenario: Stdout summary includes integrity hash

- **WHEN** a facet named "my-facet" at version "1.0.0" with 3 assets is built successfully
- **THEN** the stdout summary SHALL include the facet name, version, asset count, and a truncated integrity hash

#### Scenario: Build progress shows archive assembly stage

- **WHEN** a facet build is in progress
- **THEN** the build progress display SHALL show an archive assembly stage alongside the existing validation and output stages
