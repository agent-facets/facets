## MODIFIED Requirements

### Requirement: A facet manifest schema is published as part of the protocol

The shape of a facet manifest (`facet.json`) SHALL be published as a normative schema. Any system that produces a facet manifest SHALL produce one conforming to the published schema. Any system that consumes a facet manifest SHALL validate it against the published schema before treating any value as trusted. The schema SHALL define the required fields, the permitted shapes for skills/agents/commands, the optional `facets` and `servers` sections, the accepted facet identity grammar, and the rules for unrecognized fields.

A facet identity name SHALL be either an unscoped kebab-case name (`name`) or a scoped name (`@scope/name`). In a scoped name, both `scope` and `name` SHALL use lowercase kebab-case segments that start with a lowercase letter, contain only lowercase letters, digits, and hyphens after the first character, and end with a lowercase letter or digit. A facet manifest whose `name` is malformed SHALL be rejected as invalid. Asset names SHALL remain independently validated as local asset identifiers and SHALL NOT become scoped names.

#### Scenario: A producer emits a manifest conforming to the published schema

- **WHEN** a system produces a `facet.json` for distribution
- **THEN** the produced manifest SHALL satisfy every requirement of the published schema
- **AND** another facet-compatible system SHALL accept the manifest after validating it

#### Scenario: A consumer accepts a scoped facet identity

- **WHEN** a system receives a `facet.json` whose `name` is `@julian/cowsay`
- **THEN** the system SHALL accept the facet identity as valid
- **AND** the scoped identity SHALL remain the facet's canonical name

#### Scenario: A consumer rejects a malformed facet identity

- **WHEN** a system receives a `facet.json` whose `name` is `@julian`, `@/cowsay`, `@julian/`, `@julian/cow/say`, `@julian/cow_say`, `Cowsay`, or `../cowsay`
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error indicating that the facet identity is malformed

#### Scenario: A consumer rejects a manifest that violates the published schema

- **WHEN** a system receives a `facet.json` that omits a required field or contains a field with the wrong type
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error indicating which constraint was violated

#### Scenario: A consumer tolerates unrecognized fields

- **WHEN** a system receives a `facet.json` containing a field not defined in the schema
- **THEN** the system SHALL accept the manifest as valid
- **AND** the system SHALL preserve the unknown field if it later re-emits the manifest
