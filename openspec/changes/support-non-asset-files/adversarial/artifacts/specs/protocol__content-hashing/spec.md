## MODIFIED Requirements

### Requirement: Content hashes are computed for individual text assets

The system SHALL compute a SHA-256 content hash for every entry that ships in the inner archive: the facet manifest, each resolved text asset (skills, agents, commands), each declared skill companion file, and each declared archive-only supplementary file. Text asset hashes SHALL be computed from the file's resolved string content encoded as UTF-8. Supplementary-file hashes (skill companions and archive-only files) SHALL be computed from the file's exact bytes, with no decoding, normalization, or transformation. The hash format SHALL be `sha256:<hex-encoded hash>` (per [CLI-4](https://www.notion.so/exmachina-co/CLI-4)).

#### Scenario: Per-entry hashes computed during build

- **WHEN** a facet is built successfully with two skills, one agent, one declared skill companion file, and a declared root `README.md`
- **THEN** the build output SHALL include a content hash for each of the two skill files, the agent file, the companion file, the `README.md`, and the facet manifest
- **AND** each hash SHALL be in `sha256:<hex>` format

#### Scenario: Supplementary files are hashed from exact bytes

- **WHEN** a declared supplementary file contains binary content or unusual line endings
- **THEN** its content hash SHALL be computed from the file's exact bytes
- **AND** no normalization SHALL be applied before hashing

#### Scenario: Identical content produces identical hashes

- **WHEN** two entries contain identical resolved content
- **THEN** their content hashes SHALL be identical

#### Scenario: Any content change produces a different hash

- **WHEN** any entry's content changes by even a single byte
- **THEN** the content hash SHALL differ from the previous hash

### Requirement: Build output is assembled into a compressed archive

The system SHALL assemble all resolved build output into a two-layer archive file with the extension `.facet`. The outer layer SHALL be an uncompressed tar containing exactly two entries: `build-manifest.json` and `archive.tar.gz`. The inner `archive.tar.gz` SHALL be a gzip-compressed tar containing the facet manifest, all resolved text asset files, all declared skill companion files at their paths beneath their skill's directory, and all declared archive-only supplementary files at their declared paths. Every inner entry SHALL be derivable from a declaration in the facet manifest; the system SHALL NOT include any file that is not so derivable. The archive filename SHALL follow the pattern `<name>-<version>.facet` where `name` and `version` come from the facet manifest.

#### Scenario: Successful build produces a self-contained .facet archive

- **WHEN** a facet named "example-facet" at version "1.0.0" is built successfully
- **THEN** the system SHALL write `dist/example-facet-1.0.0.facet`
- **AND** the `.facet` file SHALL be an uncompressed tar archive
- **AND** the tar SHALL contain exactly two entries: `build-manifest.json` and `archive.tar.gz`

#### Scenario: Inner archive contains all declared assets and supplementary files

- **WHEN** a facet with two skills (one declaring a companion `references/api.md`), one agent, one command, and a declared root `README.md` is built
- **THEN** the `archive.tar.gz` entry within the `.facet` file SHALL be a gzip-compressed tar
- **AND** the inner tar SHALL contain the facet manifest, both skill files, the companion file at its path beneath its skill's directory, the agent file, the command file, and `README.md`

#### Scenario: Inner archive does not contain undeclared files

- **WHEN** a facet is built from a source tree containing files that are neither conventional asset files nor declared supplementary files
- **THEN** the inner `archive.tar.gz` SHALL contain only the facet manifest, resolved asset files, and declared supplementary files
- **AND** the undeclared files SHALL NOT be included in the archive

#### Scenario: Inner archive name is fixed

- **WHEN** any facet is built, regardless of name or version
- **THEN** the inner archive entry SHALL be named `archive.tar.gz`

### Requirement: A build manifest records content hashes

The system SHALL produce a build manifest named `build-manifest.json` embedded inside the `.facet` archive as an entry in the outer tar. The manifest SHALL contain a `facetVersion` field set to `0.2` (number), an `archive` field set to `"archive.tar.gz"`, an `integrity` field with the integrity hash, and a `files` object mapping every inner-archive entry path — the facet manifest, every asset file, and every supplementary file — to its content hash. The key set of `files` SHALL exactly equal the set of inner-archive entry paths. The manifest SHALL NOT contain the legacy `assets` map. The manifest SHALL be a flat JSON object. Every build SHALL emit `facetVersion: 0.2`, whether or not the facet declares supplementary files; the system SHALL NOT conditionally emit the legacy format.

#### Scenario: Build manifest is embedded in the .facet archive

- **WHEN** a facet is built successfully
- **THEN** the `.facet` file SHALL contain a `build-manifest.json` entry in the outer tar
- **AND** the manifest SHALL contain a `facetVersion` field set to `0.2`
- **AND** the manifest SHALL contain an `archive` field set to `"archive.tar.gz"`
- **AND** the manifest SHALL contain an `integrity` field with the integrity hash
- **AND** the manifest SHALL contain a `files` object mapping every inner-archive entry path to its content hash

#### Scenario: An asset-only facet still emits the current format

- **WHEN** a facet declaring no supplementary files is built
- **THEN** the build manifest SHALL declare `facetVersion: 0.2`
- **AND** the `files` map SHALL cover the facet manifest and every asset file

#### Scenario: Build manifest integrity hash matches inner archive contents

- **WHEN** a consumer extracts `build-manifest.json` and `archive.tar.gz` from the `.facet` file, decompresses `archive.tar.gz`, and hashes the resulting tar bytes
- **THEN** the computed hash SHALL match the `integrity` value in the manifest

#### Scenario: Build manifest file hashes match inner archive contents

- **WHEN** a consumer extracts `archive.tar.gz` from the `.facet` file, decompresses it, and hashes each individual entry
- **THEN** each computed hash SHALL match the corresponding entry in the manifest's `files` map
- **AND** no inner-archive entry SHALL lack a corresponding `files` record
- **AND** no `files` record SHALL lack a corresponding inner-archive entry

#### Scenario: Build manifest can be read without decompressing the inner archive

- **WHEN** a consumer parses the outer tar of a `.facet` file
- **THEN** the consumer SHALL be able to read `build-manifest.json` directly from the outer tar entries
- **AND** the consumer SHALL NOT need to decompress `archive.tar.gz` to access the manifest

## ADDED Requirements

### Requirement: Supplementary file content is archived verbatim

The system SHALL read, hash, and archive declared supplementary files (skill companions and archive-only files) as opaque bytes. The archived bytes SHALL be identical to the source file's bytes: no front-matter processing, no line-ending normalization, no character-encoding transformation, and no empty-content rejection. Binary content SHALL be permitted.

#### Scenario: A binary supplementary file round-trips byte-identically

- **WHEN** a facet declaring a binary supplementary file (for example an image) is built
- **THEN** the archived entry's bytes SHALL be identical to the source file's bytes
- **AND** extracting the entry SHALL reproduce the original file exactly

#### Scenario: An empty supplementary file is permitted

- **WHEN** a facet declares a zero-byte supplementary file that exists on disk
- **THEN** the build SHALL succeed
- **AND** the archive SHALL contain the empty entry with a hash of its (empty) bytes

#### Scenario: Front matter in a supplementary file is preserved

- **WHEN** a declared supplementary file begins with text that resembles YAML front matter
- **THEN** the archived bytes SHALL retain that text unmodified
- **AND** no front-matter stripping SHALL be applied
