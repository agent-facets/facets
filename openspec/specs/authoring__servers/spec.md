## Purpose

A server author writes a server manifest to declare their MCP server's identity, runtime, and entry point. The system validates and loads this manifest so authors get clear feedback when something is wrong, and downstream tools (local install, publish) get a reliable typed representation.

## Requirements

### Requirement: Valid server manifests are accepted

The system SHALL accept a server manifest that conforms to the server manifest schema defined in [ADR-5](https://www.notion.so/exmachina-co/ADR-5). A valid server manifest has a name, version, runtime, and entry point.

#### Scenario: Minimal valid server manifest

- **WHEN** a server author provides a manifest with `name`, `version`, `runtime`, and `entry`
- **THEN** the system SHALL accept the manifest

#### Scenario: Server manifest with optional fields

- **WHEN** a server author provides a manifest with all required fields plus `description` and `author`
- **THEN** the system SHALL accept the manifest

### Requirement: Invalid server manifests are rejected with actionable errors

The system SHALL reject a server manifest that does not conform to the server manifest schema. Each error SHALL identify the location of the problem and describe what was expected.

#### Scenario: Missing required field

- **WHEN** a server author provides a manifest without `runtime` or `entry`
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify which required field is missing

#### Scenario: Wrong field type

- **WHEN** a server author provides a manifest where a required field has the wrong type (e.g., `runtime: 42`)
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the field and what was expected

### Requirement: Unrecognized fields are tolerated

The system SHALL accept server manifests containing fields not defined in the current schema. Unrecognized fields SHALL be preserved, not stripped or rejected.

#### Scenario: Unknown field in server manifest

- **WHEN** a server author includes a field not defined in the schema (e.g., `license: "MIT"`)
- **THEN** the system SHALL accept the manifest
- **AND** the field SHALL be present in the loaded result

### Requirement: Server manifests are loaded from disk

The system SHALL load a server manifest by reading the server manifest file from a specified directory. JSON syntax errors and schema validation errors SHALL both be reported through a unified error interface.

#### Scenario: Successful load

- **WHEN** a valid server manifest exists in the specified directory
- **THEN** the system SHALL return the validated server manifest data

#### Scenario: File not found

- **WHEN** no server manifest exists in the specified directory
- **THEN** the system SHALL return an error indicating the file was not found

#### Scenario: Malformed JSON

- **WHEN** the server manifest contains invalid JSON syntax
- **THEN** the system SHALL return an error indicating a syntax problem
