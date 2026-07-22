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

## MODIFIED Requirements

### Requirement: Removing a facet uninstalls it

When a user removes a facet from a project, the system SHALL drop the facet from the project manifest, delete the facet's materialized assets from every selected adapter, and update the lockfile and the receipt so neither records the facet — all in a single operation. A user SHALL NOT need to run a separate install step after removing. The asset set to delete SHALL be taken from the receipt, so removal SHALL require neither the cache nor the network. Before deleting any materialized asset, the system SHALL verify that every selected installed adapter loads as a valid adapter and declares an API supported by the CLI. When a selected adapter has a missing, malformed, unsupported, or metadata-inconsistent API declaration, or cannot be loaded as a valid adapter, removal SHALL fail before deleting any materialized asset and SHALL leave the project manifest, lockfile, receipt, and materialized assets unchanged. This compatibility precondition SHALL require neither cache access nor network access; once the adapter incompatibility is repaired, removal SHALL remain able to use the receipt without either resource.

#### Scenario: Removing a declared facet uninstalls it

- **WHEN** a user removes a facet that is declared in the project manifest
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the system SHALL remove the facet's entry from the project manifest
- **AND** the system SHALL delete every asset the facet contributed from every selected adapter, using the asset set recorded in the receipt
- **AND** the system SHALL update the lockfile and the receipt so neither records the facet
- **AND** the operation SHALL complete in a single command invocation

#### Scenario: Other facets are left intact

- **WHEN** a user removes one facet from a project that declares several facets
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the system SHALL leave every other declared facet's manifest entry, lockfile entry, receipt entry, and materialized assets unchanged

#### Scenario: Removing the last facet leaves an empty project

- **WHEN** a user removes the only facet declared in the project
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the system SHALL leave the project manifest declaring no facets
- **AND** the system SHALL leave a valid lockfile that records no facets

#### Scenario: Removal deletes recorded assets without cache or network

- **WHEN** a user removes a facet whose content is absent from the cache and whose registry is unreachable
- **AND** every selected installed adapter loads as a valid adapter and declares an API supported by the CLI
- **THEN** the system SHALL still delete that facet's assets using the asset set recorded in the receipt
- **AND** removal SHALL succeed without any cache read or network access

#### Scenario: An incompatible adapter blocks removal without weakening offline recovery

- **WHEN** a user removes a facet
- **AND** a selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** removal SHALL fail before deleting any materialized asset
- **AND** the project manifest, lockfile, receipt, and materialized assets SHALL remain unchanged
- **AND** the failure SHALL NOT require or result from cache access or network access
- **AND** after the adapter incompatibility is repaired, removal SHALL remain able to use the receipt without cache or network access
