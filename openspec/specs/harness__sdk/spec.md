## Purpose

A harness is an AI coding tool (OpenCode, Claude Code, Codex, etc.) that wraps an LLM and consumes skills, agents, and commands. Harness authors use the Harness SDK to describe how their tool validates per-asset metadata and where/how assets are stored, so the system can validate manifests against specific harnesses and delegate all asset I/O to the harness that owns it.

## Requirements

### Requirement: Harness authors can define a harness using the SDK

A harness author SHALL be able to create a harness by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return a harness object. The definition SHALL accept a name, a function to build per-asset harness metadata (validating and enriching with defaults), and asset install/read/delete methods.

#### Scenario: Author creates a valid harness

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return a valid harness object with all provided properties and methods

#### Scenario: Author provides an invalid definition

- **WHEN** an author calls the factory function with a definition missing required fields
- **THEN** the factory SHALL throw an error describing which fields are missing

### Requirement: The SDK provides default behavior for missing methods

The factory function SHALL provide default behavior for asset methods that a harness author has omitted. When a harness author omits `installAsset`, `readAsset`, or `deleteAsset`, the factory SHALL provide a throw-on-call stub in its place so the returned harness always satisfies the interface shape. This is a defensive runtime check for non-TypeScript consumers; TypeScript consumers receive a compile-time error when asset methods are missing.

#### Scenario: Author omits an asset method

- **WHEN** an author calls the factory function without providing one or more of `installAsset`, `readAsset`, or `deleteAsset`
- **THEN** the factory SHALL return a valid harness object
- **AND** the omitted method SHALL throw a clear error when invoked, naming the method that was not implemented

### Requirement: The facet manifest uses "harnesses" for per-asset harness metadata

The facet manifest schema SHALL use the field name `harnesses` (not `platforms`) for per-asset harness metadata. All validation, documentation, and tooling SHALL reference this field name.

#### Scenario: Manifest with harnesses field

- **WHEN** a facet author writes a manifest with a `harnesses` field containing metadata for one or more harnesses
- **THEN** the system SHALL accept the manifest as valid

#### Scenario: Manifest with legacy platforms field

- **WHEN** a facet author writes a manifest with a `platforms` field
- **THEN** the system SHALL ignore the field per the unknown-field tolerance rules
- **AND** the `platforms` field SHALL NOT be used for harness metadata

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
