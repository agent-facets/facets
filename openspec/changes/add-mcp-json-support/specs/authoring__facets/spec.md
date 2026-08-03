## ADDED Requirements

### Requirement: Authors can declare portable MCP server connections

An author SHALL be able to declare project-scoped standard-input and Streamable HTTP MCP servers directly in `facet.json`. The declaration SHALL use the published portable shape and SHALL remain independent of any one coding tool's native configuration format. Validation failures SHALL identify the server name, field path, and expected constraint.

#### Scenario: Author declares a standard-input server

- **WHEN** an author declares a server with a valid command, arguments, and literal environment assignments
- **THEN** the system SHALL accept the declaration without requiring a separate server project

#### Scenario: Author declares an HTTP server

- **WHEN** an author declares a server with an absolute `http:` or `https:` URL
- **THEN** the system SHALL accept the declaration

#### Scenario: Unsupported server option is actionable

- **WHEN** an author declares headers, credentials, a working directory, shell behavior, variable substitution, or another unsupported field
- **THEN** the system SHALL reject the declaration and identify the server and unsupported field

### Requirement: Build validates MCP declarations without launching or contacting servers

The system SHALL validate every MCP declaration before replacing previous build output and SHALL preserve valid declarations in the embedded facet manifest. Building SHALL NOT install an executable, start a process, connect to a URL, authenticate, or create a server-specific archive entry. Invalid declarations SHALL fail the build with actionable field errors while preserving previous build output.

#### Scenario: Valid declaration is embedded without execution

- **WHEN** an author builds a facet containing a valid standard-input declaration
- **THEN** the build SHALL preserve the declaration in the embedded manifest
- **AND** it SHALL NOT locate or start the declared command

#### Scenario: HTTP declaration is not probed

- **WHEN** an author builds a facet containing a valid Streamable HTTP declaration
- **THEN** the build SHALL NOT connect to the URL or require it to be reachable

#### Scenario: Invalid declaration preserves previous output

- **WHEN** declaration validation fails and a previous successful build exists
- **THEN** the system SHALL report the server and invalid field
- **AND** the previous build output SHALL remain unchanged

#### Scenario: Server-only facet builds successfully

- **WHEN** a valid facet declares one MCP server and no text assets or composed facets
- **THEN** the build SHALL succeed with the declaration embedded in `facet.json`
- **AND** the declaration SHALL add no independent content-archive entry

## MODIFIED Requirements

### Requirement: Valid facet manifests are accepted

The system SHALL accept a facet manifest that conforms to the manifest schema. A valid current manifest has a name, a version, and at least one text asset, composed facet, or concrete MCP server declaration. The name SHALL be either an unscoped kebab-case facet identity or a scoped `@scope/name` identity. A manifest MAY include an optional top-level `private` boolean and supplementary-file declarations. Skills, agents, and commands SHALL use descriptors with required descriptions and optional platform metadata; prompt content SHALL be inferred from conventional paths rather than descriptor references.

Current-format skill, agent, command, and server names SHALL be single segments of 1–64 lowercase ASCII letters, digits, or hyphens, with no leading, trailing, or consecutive hyphens. Skills SHALL use `skills/<name>/SKILL.md`, agents `agents/<name>.md`, and commands `commands/<name>.md`. Skills and commands SHALL use disjoint names; agents and servers occupy separate namespaces and MAY share a name with another contribution kind.

#### Scenario: Minimal valid manifest with a skill

- **WHEN** an author provides a name, version, and one valid skill descriptor with a description
- **THEN** the system SHALL accept the manifest

#### Scenario: Valid manifest with a scoped facet identity

- **WHEN** an author provides name `@julian/cowsay`, a version, and one valid skill descriptor
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with all sections

- **WHEN** an author provides identity fields, skill, agent, and command descriptors, composed facets, concrete MCP server declarations, and supplementary declarations
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with only composed facets is valid

- **WHEN** an author provides `name`, `version`, and `facets` but no local skills, agents, commands, or servers
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with only a server is valid

- **WHEN** an author provides `name`, `version`, and one concrete MCP server but no text asset or composed facet
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with private publish intent is valid

- **WHEN** an author provides `private: true`, valid identity fields, and at least one deliverable
- **THEN** the system SHALL accept and preserve `private: true`

#### Scenario: Manifest with explicit public publish intent is valid

- **WHEN** an author provides `private: false`, valid identity fields, and at least one deliverable
- **THEN** the system SHALL accept and preserve `private: false`

#### Scenario: Manifest with omitted privacy remains public by default

- **WHEN** an author omits `private` from an otherwise valid manifest
- **THEN** the system SHALL accept the manifest
- **AND** loaded data SHALL NOT synthesize `private`

#### Scenario: Valid current-format asset name is accepted

- **WHEN** an author declares assets named `a`, `code-review`, and `review2`
- **THEN** the system SHALL accept those names

### Requirement: Invalid facet manifests are rejected with actionable errors

The system SHALL reject a facet manifest that does not conform to the manifest schema. Each error SHALL identify the location of the problem and describe what was expected so the author can fix it without guessing.

#### Scenario: Missing required identity field

- **WHEN** an author provides a manifest without a `name` or `version` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify which required field is missing

#### Scenario: Manifest has no deliverable

- **WHEN** an author provides identity fields but no skills, agents, commands, composed facets, or concrete MCP server declarations
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL indicate that at least one deliverable is required

#### Scenario: Agent missing its description

- **WHEN** an author defines an agent without a `description` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the agent by name and the missing field

#### Scenario: Selective facets entry with no asset selection

- **WHEN** an author writes a selective facets entry with `name` and `version` but no `skills`, `agents`, or `commands`
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL indicate that at least one asset type must be selected

#### Scenario: Server declaration omits its type

- **WHEN** an author writes a server declaration without `type`
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the server by name and the missing field

#### Scenario: Server declaration has an invalid connection field

- **WHEN** an author writes an empty standard-input command or a non-absolute HTTP URL
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the server and invalid field

#### Scenario: Privacy declaration is not boolean

- **WHEN** an author writes `private` as a string, number, object, array, or null
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify `private` and indicate that a boolean value is expected

### Requirement: Unrecognized fields are tolerated

The system SHALL accept manifests containing fields not defined in the current schema and SHALL preserve them, except that unrecognized members inside an MCP server declaration SHALL be rejected. This boundary allows top-level and descriptor extensions while preventing silent disagreement about execution-affecting server configuration.

#### Scenario: Top-level unknown field

- **WHEN** an author includes a field not defined in the schema, such as `license: "MIT"`
- **THEN** the system SHALL accept the manifest
- **AND** the field SHALL be present in the loaded result

#### Scenario: Unknown field nested in an asset descriptor

- **WHEN** an agent descriptor includes a field not defined in the schema
- **THEN** the system SHALL accept the manifest
- **AND** the field SHALL be present in the loaded result

#### Scenario: Unknown field nested in a server declaration

- **WHEN** an MCP server declaration includes a field not defined by its selected declaration type
- **THEN** the system SHALL reject the manifest and identify that field
