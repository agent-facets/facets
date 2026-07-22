## ADDED Requirements

### Requirement: Facet operations require compatible selected adapters before mutation

Before adding, removing, or installing facets, the system SHALL verify that every selected installed adapter declares an API supported by the current CLI. If a selected adapter is missing its declaration, has a malformed or unsupported declaration, conflicts with its recorded package declaration, or cannot be loaded as a valid adapter, the operation SHALL fail before invoking any adapter contract method or writing project or materialized state. The failure SHALL identify every incompatible selected adapter and provide the best available compatible-install command. The system SHALL NOT automatically upgrade or replace an incompatible adapter during a facet operation.

Facet removal SHALL remain independent of cached facet content and network access, but it SHALL still require compatible selected adapters because deleting materialized assets invokes each selected adapter's contract.

#### Scenario: Adding a facet with an incompatible selected adapter changes nothing

- **WHEN** a user adds a facet
- **AND** a selected installed adapter does not declare an API supported by the CLI
- **THEN** the operation SHALL fail before any facet is materialized
- **AND** no adapter contract method SHALL be invoked
- **AND** the project manifest, lockfile, install receipt, and materialized assets SHALL remain unchanged
- **AND** the error SHALL direct the user to install a compatible adapter

#### Scenario: Installing with several incompatible adapters reports all of them

- **WHEN** a user installs the project's declared facets
- **AND** more than one selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** the operation SHALL fail before any materialization write
- **AND** the failure SHALL identify every incompatible selected adapter and every selected adapter that cannot be loaded
- **AND** each compatibility failure SHALL include its best available repair command

#### Scenario: Removing a facet does not bypass adapter compatibility

- **WHEN** a user removes a facet
- **AND** a selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** the operation SHALL fail before deleting any materialized asset
- **AND** the project manifest, lockfile, install receipt, and materialized assets SHALL remain unchanged

#### Scenario: Compatible selected adapters allow facet operations to proceed

- **WHEN** a user adds or installs a facet
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the operation SHALL proceed through the applicable fetch, integrity verification, materialization, and project-state update requirements

#### Scenario: Facet operation does not auto-upgrade an incompatible adapter

- **WHEN** a facet operation detects an incompatible selected adapter
- **THEN** the system SHALL NOT download or activate a replacement adapter automatically
- **AND** the failure SHALL direct the user to an explicit adapter install command
