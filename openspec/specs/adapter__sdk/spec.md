## Purpose

An adapter is an AI coding tool (OpenCode, Claude Code, Codex, etc.) that wraps an LLM and consumes skills, agents, and commands. Adapter authors use the Adapter SDK to describe how their tool validates per-asset metadata and where/how assets are stored, so the system can validate manifests against specific adapters and delegate all asset I/O to the adapter that owns it.

## Requirements

### Requirement: Adapter authors can define an adapter using the SDK

An adapter author SHALL be able to create an adapter by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return an adapter object. The definition SHALL accept a name, a function to build per-asset adapter metadata (validating and enriching with defaults), and asset install/read/delete methods.

#### Scenario: Author creates a valid adapter

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return a valid adapter object with all provided properties and methods

#### Scenario: Author provides an invalid definition

- **WHEN** an author calls the factory function with a definition missing required fields
- **THEN** the factory SHALL throw an error describing which fields are missing

### Requirement: The SDK provides default behavior for missing methods

The factory function SHALL provide default behavior for asset methods that an adapter author has omitted. When an adapter author omits `installAsset`, `readAsset`, or `deleteAsset`, the factory SHALL provide a throw-on-call stub in its place so the returned adapter always satisfies the interface shape. This is a defensive runtime check for non-TypeScript consumers; TypeScript consumers receive a compile-time error when asset methods are missing.

#### Scenario: Author omits an asset method

- **WHEN** an author calls the factory function without providing one or more of `installAsset`, `readAsset`, or `deleteAsset`
- **THEN** the factory SHALL return a valid adapter object
- **AND** the omitted method SHALL throw a clear error when invoked, naming the method that was not implemented

### Requirement: The facet manifest uses "adapters" for per-asset adapter metadata

The facet manifest schema SHALL use the field name `adapters` (not `platforms`) for per-asset adapter metadata. All validation, documentation, and tooling SHALL reference this field name.

#### Scenario: Manifest with adapters field

- **WHEN** a facet author writes a manifest with an `adapters` field containing metadata for one or more adapters
- **THEN** the system SHALL accept the manifest as valid

#### Scenario: Manifest with legacy platforms field

- **WHEN** a facet author writes a manifest with a `platforms` field
- **THEN** the system SHALL ignore the field per the unknown-field tolerance rules
- **AND** the `platforms` field SHALL NOT be used for adapter metadata

### Requirement: The build pipeline accepts adapters as inputs

The build pipeline SHALL accept an array of adapter objects as a parameter for metadata building. The pipeline SHALL delegate metadata building (validation + enrichment) to each adapter rather than maintaining an internal registry.

#### Scenario: Build metadata with matching adapter

- **WHEN** the build pipeline processes a facet manifest that includes adapter metadata for "opencode"
- **AND** an "opencode" adapter object is provided
- **THEN** the pipeline SHALL pass the metadata to the adapter's build function
- **AND** use the enriched metadata returned on success
- **AND** report any errors returned on failure

#### Scenario: Unknown adapter in manifest

- **WHEN** the build pipeline processes a facet manifest that includes adapter metadata for "cursor"
- **AND** no "cursor" adapter object is provided
- **THEN** the pipeline SHALL produce a warning that the adapter is unknown
- **AND** the pipeline SHALL NOT produce an error

### Requirement: First-party and third-party adapters use the same installation and loading mechanism

First-party adapters (for AI coding tools maintained by the project) SHALL be installed and loaded using the same mechanism as third-party adapters. There SHALL be no separate code path for first-party adapters.

#### Scenario: First-party adapter installed via CLI

- **WHEN** a user installs a first-party adapter using a built-in name
- **THEN** the system SHALL install the adapter using the same pipeline as any third-party adapter

#### Scenario: First-party adapter loaded at runtime

- **WHEN** the system loads adapters at runtime
- **THEN** first-party and third-party adapters SHALL be loaded from the same directory using the same mechanism
