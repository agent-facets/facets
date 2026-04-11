## ADDED Requirements

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

### Requirement: Harnesses provide asset creation

A harness SHALL accept a request to create an asset at a given location. The harness SHALL receive the location, asset type, asset name, content, and per-asset metadata. The harness SHALL handle all storage concerns internally — including path resolution, directory creation, metadata assembly, and file format.

#### Scenario: Create a skill asset

- **WHEN** the system requests a harness to create a skill with a name, content, and metadata at a given location
- **THEN** the harness SHALL store the asset at the appropriate place within that location
- **AND** the harness SHALL incorporate the metadata into the stored asset according to its tool's conventions

#### Scenario: Create an asset at a user-scoped location

- **WHEN** the system requests a harness to create an asset at a user-scoped location
- **THEN** the harness SHALL store the asset using the absolute path from that location

### Requirement: Harnesses provide asset reading

A harness SHALL accept a request to read an asset from a given location. The harness SHALL receive the location, asset type, and asset name, and SHALL return the asset's content.

#### Scenario: Read an existing asset

- **WHEN** the system requests a harness to read a skill by name from a given location
- **THEN** the harness SHALL return the asset's content

#### Scenario: Read a non-existent asset

- **WHEN** the system requests a harness to read an asset that does not exist at the given location
- **THEN** the harness SHALL indicate that the asset was not found

### Requirement: Harnesses provide asset updating

A harness SHALL accept a request to update an existing asset at a given location. The harness SHALL receive the location, asset type, asset name, new content, and updated metadata. The harness SHALL handle all storage concerns internally.

#### Scenario: Update an existing asset

- **WHEN** the system requests a harness to update a skill with new content and metadata
- **THEN** the harness SHALL replace the asset's content and metadata at that location

### Requirement: Harnesses provide asset deletion

A harness SHALL accept a request to delete an asset from a given location. The harness SHALL receive the location, asset type, and asset name.

#### Scenario: Delete an existing asset

- **WHEN** the system requests a harness to delete a skill by name from a given location
- **THEN** the harness SHALL remove the asset from that location

#### Scenario: Delete a non-existent asset

- **WHEN** the system requests a harness to delete an asset that does not exist at the given location
- **THEN** the harness SHALL indicate that the asset was not found

### Requirement: Asset CRUD is the only interface for asset storage

The system SHALL NOT directly read or write assets for any harness. All asset operations SHALL go through the harness's CRUD methods. The harness owns all knowledge of its tool's storage format, directory structure, and metadata conventions. CRUD methods SHALL always receive location objects with absolute paths — the system is responsible for resolving any relative paths before calling CRUD.

#### Scenario: CLI delegates asset creation to harness

- **WHEN** the system needs to install an asset for a specific harness
- **THEN** the system SHALL call the harness's create method
- **AND** the system SHALL NOT directly write files to the harness's asset directories

#### Scenario: CRUD receives absolute paths

- **WHEN** the system calls any CRUD method on a harness
- **THEN** the location passed to the method SHALL have an absolute path
- **AND** the system SHALL have resolved any relative paths before the call
