## MODIFIED Requirements

### Requirement: Authors can declare portable MCP server connections

An author SHALL be able to declare standard-input and Streamable HTTP MCP servers directly in `facet.json` without selecting an installation scope. The declaration SHALL use the published portable shape and SHALL remain independent of any one coding tool's native configuration format. The same declaration SHALL be usable for project and user installations without an author opt-in or republishing. Validation failures SHALL identify the server name, field path, and expected constraint.

#### Scenario: Author declares a standard-input server

- **WHEN** an author declares a server with a valid command, arguments, and literal environment assignments
- **THEN** the system SHALL accept the declaration without requiring a separate server project

#### Scenario: Author declares an HTTP server

- **WHEN** an author declares a server with an absolute `http:` or `https:` URL
- **THEN** the system SHALL accept the declaration

#### Scenario: Unsupported server option is actionable

- **WHEN** an author declares headers, credentials, a working directory, shell behavior, variable substitution, or another unsupported field
- **THEN** the system SHALL reject the declaration and identify the server and unsupported field

#### Scenario: Existing server declaration supports a user installation

- **WHEN** a user selects an already published server-only facet for user installation
- **THEN** the author SHALL NOT need to add an installation-scope field or publish a user-specific variant
- **AND** the authored command or URL SHALL retain its literal meaning

## ADDED Requirements

### Requirement: Authors publish one facet for project and user installations

Authors SHALL define skills, agents, commands, skill companions, MCP declarations, and archive-only supplementary files independently of the consumer's installation scope. Selecting project or user installation SHALL NOT require changed conventional source paths, a different artifact, scope-specific descriptors, or republishing. Authored primary files, declared companions, and archive-only supplementary files SHALL remain the same content in either scope; top-level archive-only supplementary files SHALL remain archive-only.

#### Scenario: A mixed facet needs no user-specific package

- **WHEN** a facet contains a skill with a binary companion, an agent, a command, and a concrete MCP declaration
- **AND** consumers select the same published version for project and user installation
- **THEN** both SHALL use the same authored artifact and integrity
- **AND** the author SHALL NOT need to declare native user directories or duplicate any contribution

#### Scenario: Selecting user scope does not promote archive-only files

- **WHEN** a published facet includes a top-level `README.md` and a declared skill companion
- **AND** a consumer selects user installation
- **THEN** the companion SHALL remain part of the skill's materializable bundle
- **AND** `README.md` SHALL remain archive-only

#### Scenario: Manifest extensions cannot select installation scope

- **WHEN** an otherwise valid facet manifest contains an unrecognized `scope` member at the top level or on an asset descriptor
- **THEN** that member SHALL be accepted and preserved as opaque extension data, but SHALL NOT change the consumer's selected installation scope

#### Scenario: Build output does not vary by intended installation scope

- **WHEN** an author builds the same unchanged facet sources twice, intending one artifact for project installation and the other for user installation
- **THEN** the builds SHALL produce byte-identical archives and SHALL NOT request or record an installation scope

#### Scenario: Scaffolding does not ask for installation scope

- **WHEN** an author scaffolds a new facet interactively
- **THEN** the wizard SHALL NOT prompt for a project or user installation scope
