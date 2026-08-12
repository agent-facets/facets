## ADDED Requirements

### Requirement: Untracked occupied asset destinations are confirmed before adoption or overwrite

When an asset's desired effective destination is already occupied by content this project's machine-local record does not own, the occupancy SHALL be disclosed through a just-in-time confirmation during application, using the previous-state read the operation already performs rather than an additional eager scan of the project. Continuing SHALL be the default: content equivalent to the desired state SHALL be adopted without rewriting, divergent content SHALL be overwritten transactionally, and either way ownership SHALL be recorded only through the operation's successful commit. An interactive cancellation SHALL roll back the complete operation. Non-interactive operations SHALL continue automatically, preserving existing behavior. A destination the record already owns SHALL be reconciled without a takeover confirmation.

#### Scenario: Untracked occupied destination is disclosed during application

- **WHEN** an interactive install reaches an asset whose effective destination holds untracked content
- **THEN** the user SHALL be shown the takeover before that destination is adopted or overwritten
- **AND** continuing SHALL be the default choice

#### Scenario: Equivalent untracked content is adopted without a write

- **WHEN** the occupying content is equivalent to the desired asset
- **AND** the user continues
- **THEN** the destination SHALL be adopted without rewriting it
- **AND** the commit SHALL record the identity as tracked

#### Scenario: Cancelling a takeover rolls back the operation

- **WHEN** the user cancels at an asset takeover confirmation
- **THEN** every change the operation already applied SHALL be rolled back
- **AND** the manifest, lockfile, and receipt SHALL remain unchanged

#### Scenario: Non-interactive install continues automatically

- **WHEN** a non-interactive install encounters an untracked occupied asset destination
- **THEN** the operation SHALL continue and reconcile the destination
- **AND** the outcome SHALL be reported

#### Scenario: Owned destination is not a takeover

- **WHEN** a desired asset's destination is owned by the machine-local record
- **THEN** reconciliation SHALL proceed without a takeover confirmation

## MODIFIED Requirements

### Requirement: Asset methods are the only interface for asset storage

The system SHALL perform every primary-asset and skill-companion storage operation through the selected adapter's install, read, and delete operations. It SHALL NOT directly inspect or modify adapter asset directories. The adapter SHALL own its tool's storage format, roots, path resolution, metadata conventions, and skill-bundle lifecycle. Archive-only supplementary files SHALL never be passed to an adapter.

This asset-methods-only rule SHALL govern text assets — skills, agents, commands, and skill companions — exclusively. Keyed configuration contributions reconciled inside shared tool-owned files SHALL NOT be expressed as asset install, read, or delete requests; they use their own capability contract with distinct request, occupancy, and atomicity semantics. Text assets SHALL NOT gain a configuration-flavored type, and configuration SHALL NOT be smuggled through the asset methods.

The tagged request/result shapes of the asset install, read, and delete operations constitute the asset method contract identified by adapter API `0.1` and carried unchanged into `0.2`; a consumer SHALL NOT invoke them on an adapter declaring the superseded positional API `0.0`.

#### Scenario: System delegates primary and companion installation

- **WHEN** a skill primary and companions must be installed for an adapter
- **THEN** the system SHALL submit one skill installation request
- **AND** SHALL NOT write any requested file directly into the adapter tree

#### Scenario: Archive-only supplementary file is withheld

- **WHEN** a verified archive includes root `README.md`
- **THEN** the system SHALL NOT include that file in any adapter request

#### Scenario: Configuration is not expressed as an asset

- **WHEN** a facet's MCP server declarations are materialized
- **THEN** no asset install, read, or delete request SHALL carry the configuration
- **AND** the asset type set SHALL remain skills, agents, and commands
