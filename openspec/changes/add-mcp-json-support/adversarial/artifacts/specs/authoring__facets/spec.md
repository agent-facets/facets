## ADDED Requirements

### Requirement: Facet authors declare portable MCP connection configuration with actionable feedback

A facet author SHALL be able to declare project-scoped MCP servers directly in `facet.json` as concrete stdio or Streamable HTTP declarations, and SHALL receive actionable validation errors when a declaration is malformed. Each error SHALL identify the server by name and field path and describe what was expected. Authors SHALL NOT be able to declare HTTP headers, secrets, OAuth credentials, or environment-variable substitution in a declaration; an unrecognized declaration member SHALL be rejected with an error naming the member rather than silently ignored.

#### Scenario: Author declares a stdio server

- **WHEN** an author declares a server with `type: "stdio"`, a non-empty command, arguments, and literal environment values
- **THEN** the system SHALL accept the manifest

#### Scenario: Author declares an HTTP server

- **WHEN** an author declares a server with `type: "http"` and an absolute `https:` URL
- **THEN** the system SHALL accept the manifest

#### Scenario: Missing command is reported by server and field

- **WHEN** an author declares a stdio server without a `command`
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the server name and the missing field

#### Scenario: Unrecognized declaration member is reported by name

- **WHEN** an author adds `headers` or another undeclared member to a server declaration
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL name the unrecognized member so the author knows the field is not portable

#### Scenario: Invalid environment name is reported

- **WHEN** an author declares an `env` key outside the portable ASCII environment-name grammar
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the server and the invalid environment name

## MODIFIED Requirements

### Requirement: Valid facet manifests are accepted

The system SHALL accept a facet manifest that conforms to the manifest schema. A valid manifest has a name, a version, and at least one text asset, composed facet, or concrete MCP server declaration. The name SHALL be either an unscoped kebab-case facet identity or a scoped `@scope/name` identity. A manifest MAY include an optional top-level `private` boolean and supplementary-file declarations. Skills, agents, and commands SHALL use descriptors with required descriptions and optional platform metadata; prompt content SHALL be inferred from conventional paths rather than descriptor references. Servers SHALL be declared as concrete portable stdio or Streamable HTTP declarations, never as version strings or image references.

Current-format skill, agent, and command names SHALL be single segments of 1–64 lowercase ASCII letters, digits, or hyphens, with no leading, trailing, or consecutive hyphens. Skills SHALL use `skills/<name>/SKILL.md`, agents `agents/<name>.md`, and commands `commands/<name>.md`. Skills and commands SHALL use disjoint names; agents MAY share a name with either. Server names SHALL use the same single-segment grammar and occupy their own namespace.

#### Scenario: Minimal valid manifest with a skill

- **WHEN** an author provides a name, version, and one valid skill descriptor with a description
- **THEN** the system SHALL accept the manifest

#### Scenario: Valid manifest with a scoped facet identity

- **WHEN** an author provides name `@julian/cowsay`, a version, and one valid skill descriptor
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with all sections

- **WHEN** an author provides identity fields, skill, agent, and command descriptors, composed facets, concrete server declarations, and supplementary declarations
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with only composed facets is valid

- **WHEN** an author provides `name`, `version`, and `facets` but no local skills, agents, or commands
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with only server declarations is valid

- **WHEN** an author provides `name`, `version`, and one or more concrete server declarations but no skills, agents, commands, or composed facets
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with private publish intent is valid

- **WHEN** an author provides `private: true`, valid identity fields, and at least one text asset
- **THEN** the system SHALL accept and preserve `private: true`

#### Scenario: Manifest with explicit public publish intent is valid

- **WHEN** an author provides `private: false`, valid identity fields, and at least one text asset
- **THEN** the system SHALL accept and preserve `private: false`

#### Scenario: Manifest with omitted privacy remains public by default

- **WHEN** an author omits `private` from an otherwise valid manifest
- **THEN** the system SHALL accept the manifest
- **AND** loaded data SHALL NOT synthesize `private`

#### Scenario: Valid current-format asset name is accepted

- **WHEN** an author declares assets named `a`, `code-review`, and `review2`
- **THEN** the system SHALL accept those names

### Requirement: Invalid facet manifests are rejected with actionable errors

The system SHALL reject a facet manifest that does not conform to the manifest schema. Each error SHALL identify the location of the problem (field path) and describe what was expected, so the author can fix it without guessing.

#### Scenario: Missing required identity field

- **WHEN** an author provides a manifest without a `name` or `version` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify which required field is missing

#### Scenario: No deliverables at all

- **WHEN** an author provides a manifest with identity fields but no skills, agents, commands, composed facets, or server declarations
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL indicate that at least one asset, composed facet, or server declaration is required

#### Scenario: Agent missing its description

- **WHEN** an author defines an agent without a `description` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the agent by name and the missing field

#### Scenario: Selective facets entry with no asset selection

- **WHEN** an author writes a selective facets entry with `name` and `version` but no `skills`, `agents`, or `commands`
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL indicate that at least one asset type must be selected

#### Scenario: Speculative server reference is rejected

- **WHEN** an author writes a server value as a version string or an `{ image }` object
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the server by name and indicate that a concrete stdio or HTTP declaration is required

#### Scenario: Privacy declaration is not boolean

- **WHEN** an author writes `private` as a string, number, object, array, or null
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify `private` and indicate that a boolean value is expected
