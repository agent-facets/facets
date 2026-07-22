## ADDED Requirements

### Requirement: Facet installation rejects an incompatible selected adapter before writing

When a facet install or add operation would materialize assets into a selected adapter whose installed bundle declares a missing, malformed, or unsupported adapter API version, the system SHALL fail before any materialization writes occur. The failure SHALL include structured, actionable diagnostics identifying the adapter, its declared or missing adapter API, the supported adapter APIs, and the command that installs a compatible adapter release. The system SHALL NOT automatically upgrade or replace the incompatible adapter as part of the facet operation.

#### Scenario: Incompatible selected adapter fails before materialization

- **WHEN** a user runs a facet install or add
- **AND** a selected adapter's installed bundle declares a missing or unsupported adapter API version
- **THEN** the operation SHALL fail before any asset is written to any adapter tree
- **AND** the system SHALL leave the project manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Incompatibility diagnostics direct the user to a compatible install

- **WHEN** a facet install or add fails because a selected adapter is incompatible
- **THEN** the diagnostics SHALL identify the adapter, its declared or missing adapter API, and the supported adapter APIs
- **AND** the diagnostics SHALL include the command the user can run to install a compatible adapter release
- **AND** the system SHALL NOT install a different adapter release automatically

#### Scenario: Compatible selected adapters install normally

- **WHEN** a user runs a facet install or add
- **AND** every selected adapter's installed bundle declares a supported adapter API version
- **THEN** the operation SHALL proceed through fetch, verification, materialization, and lockfile update as specified elsewhere in this spec
