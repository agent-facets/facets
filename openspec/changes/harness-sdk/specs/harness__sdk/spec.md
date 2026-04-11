## ADDED Requirements

### Requirement: Harness authors can define a harness using the SDK

A harness author SHALL be able to create a harness by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return a harness object. The definition SHALL accept a name, asset locations, config locations, a function to build per-asset harness metadata (validating and enriching with defaults), and asset CRUD methods.

#### Scenario: Author creates a valid harness

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return a valid harness object with all provided properties and methods

#### Scenario: Author provides an invalid definition

- **WHEN** an author calls the factory function with a definition missing required fields
- **THEN** the factory SHALL throw an error describing which fields are missing

### Requirement: Harnesses provide asset locations as scoped paths

A harness SHALL provide an ordered array of asset locations. Each location SHALL include a path, a scope classification (system, user, or project), and a type discriminant (directory or file). The array SHALL be ordered by precedence, with the highest-precedence location first.

#### Scenario: Harness provides project and user asset locations

- **WHEN** the system queries a harness for its asset locations
- **THEN** the harness SHALL return an ordered array of locations with path, scope, and type
- **AND** the first element SHALL be the highest-precedence location

#### Scenario: Asset location scopes determine path format

- **WHEN** an asset location has project scope
- **THEN** its path SHALL be relative to the project root
- **WHEN** an asset location has user or system scope
- **THEN** its path SHALL be an absolute filesystem path

### Requirement: Harnesses provide config locations as scoped paths

A harness SHALL provide an ordered array of config locations. Each location SHALL include a path, a scope classification, and a type discriminant. The array SHALL be ordered by precedence, with the highest-precedence location first. Config locations typically point to specific files rather than directories.

#### Scenario: Harness provides config file locations

- **WHEN** the system queries a harness for its config locations
- **THEN** the harness SHALL return an ordered array of locations with path, scope, and type

### Requirement: The SDK provides default behavior for optional methods

The factory function SHALL provide default behavior for methods that are optional in this change. When a harness author omits asset CRUD methods, the factory SHALL provide stub implementations. Future optional methods (e.g., config CRUD) SHALL follow the same pattern.

#### Scenario: Author omits asset CRUD methods

- **WHEN** an author calls the factory function without providing asset CRUD methods
- **THEN** the factory SHALL return a valid harness object
- **AND** the CRUD methods SHALL have stub implementations

### Requirement: The facet manifest uses "harnesses" for per-asset harness metadata

The facet manifest schema SHALL use the field name `harnesses` (not `platforms`) for per-asset harness metadata. All validation, documentation, and tooling SHALL reference this field name.

#### Scenario: Manifest with harnesses field

- **WHEN** a facet author writes a manifest with a `harnesses` field containing metadata for one or more harnesses
- **THEN** the system SHALL accept the manifest as valid

#### Scenario: Manifest with legacy platforms field

- **WHEN** a facet author writes a manifest with a `platforms` field
- **THEN** the system SHALL reject the manifest as invalid

### Requirement: The build pipeline accepts harnesses as inputs

The build pipeline SHALL accept an array of harness objects as a parameter for metadata building. The pipeline SHALL delegate metadata building (validation + enrichment) to each harness rather than maintaining an internal registry.

#### Scenario: Build metadata with matching harness

- **WHEN** the build pipeline processes a facet manifest that includes harness metadata for "opencode"
- **AND** an "opencode" harness object is provided
- **THEN** the pipeline SHALL pass the metadata to the harness's build function
- **AND** use the enriched metadata returned on success
- **AND** report any errors returned on failure

#### Scenario: Unknown harness in manifest

- **WHEN** the build pipeline processes a facet manifest that includes harness metadata for "cursor"
- **AND** no "cursor" harness object is provided
- **THEN** the pipeline SHALL produce a warning that the harness is unknown
- **AND** the pipeline SHALL NOT produce an error

### Requirement: First-party and third-party harnesses use the same installation and loading mechanism

First-party harnesses (for AI coding tools maintained by the project) SHALL be installed and loaded using the same mechanism as third-party harnesses. There SHALL be no separate code path for first-party harnesses.

#### Scenario: First-party harness installed via CLI

- **WHEN** a user installs a first-party harness using a built-in name
- **THEN** the system SHALL install the harness using the same pipeline as any third-party harness

#### Scenario: First-party harness loaded at runtime

- **WHEN** the system loads harnesses at runtime
- **THEN** first-party and third-party harnesses SHALL be loaded from the same directory using the same mechanism
