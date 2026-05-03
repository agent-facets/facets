## ADDED Requirements

### Requirement: A facet manifest schema is published as part of the protocol

The shape of a facet manifest (`facet.json`) SHALL be published as a normative schema. Any system that produces a facet manifest SHALL produce one conforming to the published schema. Any system that consumes a facet manifest SHALL validate it against the published schema before treating any value as trusted. The schema SHALL define the required fields, the permitted shapes for skills/agents/commands, the optional `facets` and `servers` sections, and the rules for unrecognized fields.

#### Scenario: A producer emits a manifest conforming to the published schema

- **WHEN** a system produces a `facet.json` for distribution
- **THEN** the produced manifest SHALL satisfy every requirement of the published schema
- **AND** another facet-compatible system SHALL accept the manifest after validating it

#### Scenario: A consumer rejects a manifest that violates the published schema

- **WHEN** a system receives a `facet.json` that omits a required field or contains a field with the wrong type
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error indicating which constraint was violated

#### Scenario: A consumer tolerates unrecognized fields

- **WHEN** a system receives a `facet.json` containing a field not defined in the schema
- **THEN** the system SHALL accept the manifest as valid
- **AND** the system SHALL preserve the unknown field if it later re-emits the manifest

### Requirement: A project manifest schema is published as part of the protocol

The shape of a project manifest (`facets.json`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a project manifest SHALL conform to the published schema. The schema SHALL define how facet sources are listed, how version specifiers are expressed, and how compact and selective forms are distinguished.

#### Scenario: A consumer interprets a project manifest correctly

- **WHEN** a system reads a `facets.json` containing a list of facet sources with version specifiers
- **THEN** the system SHALL interpret each source per the published schema
- **AND** ambiguous interpretations SHALL be rejected with a structured error

#### Scenario: A producer writes a project manifest conforming to the schema

- **WHEN** a system adds a new facet to a project's `facets.json`
- **THEN** the resulting file SHALL satisfy the published schema
- **AND** another facet-compatible system SHALL accept the file after validating it

### Requirement: A lockfile schema is published as part of the protocol

The shape of a lockfile (`facets.lock`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a lockfile SHALL conform to the published schema. The schema SHALL define the lockfile version, source-provenance fields, identity-and-integrity fields, the asset list, and the rules for unrecognized fields.

#### Scenario: A consumer interprets a lockfile written by a different system

- **WHEN** a system reads a `facets.lock` written by a different facet-compatible system
- **THEN** the system SHALL interpret every field per the published schema
- **AND** the system SHALL accept the lockfile as valid input for installation

#### Scenario: A producer writes a lockfile that any consumer can read

- **WHEN** a system writes a `facets.lock` after resolving facet sources
- **THEN** the resulting file SHALL satisfy the published schema
- **AND** another facet-compatible system SHALL be able to read the file and reproduce the same install state

### Requirement: A build manifest schema is published as part of the protocol

The shape of a build manifest (`build-manifest.json`) embedded inside a `.facet` archive SHALL be published as a normative schema. Any system that produces a `.facet` archive SHALL include a build manifest conforming to the schema. Any system that consumes a `.facet` archive SHALL validate the embedded build manifest against the schema before trusting its values.

#### Scenario: A producer embeds a conforming build manifest

- **WHEN** a system produces a `.facet` archive
- **THEN** the embedded `build-manifest.json` SHALL conform to the published schema
- **AND** the manifest SHALL declare the protocol version, the inner archive name, the integrity hash, and the per-asset hash table

#### Scenario: A consumer rejects an archive whose build manifest violates the schema

- **WHEN** a system receives a `.facet` archive whose `build-manifest.json` is missing a required field or has a malformed integrity value
- **THEN** the system SHALL reject the archive as invalid
- **AND** the system SHALL surface a structured error identifying the violation

### Requirement: A server manifest schema is published as part of the protocol

The shape of a server manifest SHALL be published as a normative schema. Any system that declares an MCP server reference within a facet manifest SHALL conform to the published shape. Any system that interprets a server reference SHALL conform to the published rules for source-mode versus ref-mode declarations.

#### Scenario: A producer declares servers in source-mode and ref-mode

- **WHEN** a system writes a facet manifest containing both source-mode (floor version) and ref-mode (image reference) server declarations
- **THEN** the resulting declarations SHALL each satisfy the published schema for their respective form

#### Scenario: A consumer interprets server declarations consistently

- **WHEN** a system reads a facet manifest with mixed-mode server declarations
- **THEN** the system SHALL interpret each declaration per the published schema
- **AND** ambiguous declarations SHALL be rejected with a structured error
