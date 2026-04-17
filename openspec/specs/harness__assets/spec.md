## Purpose

Each harness is a full abstraction layer over its AI coding tool's storage. The system never reads or writes asset files directly — all asset operations go through the harness's install, read, and delete methods. This lets each harness own its tool's directory structure, file format, frontmatter conventions, and metadata handling, and lets the system remain tool-agnostic.

## Requirements

### Requirement: Harnesses build per-asset metadata with validation and defaults

A harness SHALL accept raw per-asset metadata from a facet manifest, validate it, apply harness-specific defaults, and return the enriched metadata object. The result SHALL be a discriminated type: either success with the enriched metadata or failure with structured errors. Each error SHALL include the path to the invalid field, a human-readable message, what was expected, and what was actually found.

#### Scenario: Metadata builds successfully

- **WHEN** a harness builds metadata from input that conforms to its schema
- **THEN** the result SHALL indicate success
- **AND** the result SHALL include the enriched metadata object with any harness-specific defaults applied

#### Scenario: Metadata build fails validation

- **WHEN** a harness builds metadata from input that does not conform to its schema
- **THEN** the result SHALL indicate failure
- **AND** the result SHALL include one or more errors, each with a field path, message, expected value, and actual value

#### Scenario: Harness applies default values

- **WHEN** a harness builds metadata from input that omits optional fields
- **THEN** the enriched metadata SHALL include the harness's default values for those fields

### Requirement: Harnesses provide asset installation

A harness SHALL accept a request to install an asset at a given scope. The harness SHALL receive the scope, asset type, asset name, content, and per-asset metadata. The harness SHALL handle all storage concerns internally — including path resolution, directory creation, metadata assembly, and file format. Installation SHALL be idempotent: installing an asset whose name already exists at that scope SHALL overwrite the existing asset.

#### Scenario: Install a skill asset

- **WHEN** the system requests a harness to install a skill with a name, content, and metadata at a given scope
- **THEN** the harness SHALL store the asset internally at the location appropriate for that scope
- **AND** the harness SHALL incorporate the metadata into the stored asset according to its tool's conventions

#### Scenario: Install an asset at the user scope

- **WHEN** the system requests a harness to install an asset at the user scope
- **THEN** the harness SHALL store the asset using the harness's user-level storage root

#### Scenario: Installing an asset with an existing name

- **WHEN** the system requests a harness to install an asset whose name already exists at the given scope
- **THEN** the harness SHALL overwrite the existing asset with the new content and metadata
- **AND** the harness SHALL NOT produce an error for the name collision

### Requirement: Harnesses provide asset reading

A harness SHALL accept a request to read an asset from a given scope. The harness SHALL receive the scope, asset type, and asset name, and SHALL return both the asset's content and any harness-specific metadata stored alongside it.

#### Scenario: Read an existing asset

- **WHEN** the system requests a harness to read a skill by name from a given scope
- **THEN** the harness SHALL return the asset's content and metadata

#### Scenario: Read a non-existent asset

- **WHEN** the system requests a harness to read an asset that does not exist at the given scope
- **THEN** the harness SHALL indicate that the asset was not found

### Requirement: Harnesses provide asset deletion

A harness SHALL accept a request to delete an asset from a given scope. The harness SHALL receive the scope, asset type, and asset name.

#### Scenario: Delete an existing asset

- **WHEN** the system requests a harness to delete a skill by name from a given scope
- **THEN** the harness SHALL remove the asset from that scope

#### Scenario: Delete a non-existent asset

- **WHEN** the system requests a harness to delete an asset that does not exist at the given scope
- **THEN** the harness SHALL indicate that the asset was not found

### Requirement: Asset methods are the only interface for asset storage

The system SHALL NOT directly read or write assets for any harness. All asset operations SHALL go through the harness's install, read, and delete methods. The harness owns all knowledge of its tool's storage format, directory structure, path resolution, and metadata conventions.

#### Scenario: System delegates asset installation to harness

- **WHEN** the system needs to install an asset for a specific harness
- **THEN** the system SHALL call the harness's install method
- **AND** the system SHALL NOT directly write files to the harness's asset directories
