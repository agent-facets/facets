## ADDED Requirements

### Requirement: Untracked occupied asset destinations require just-in-time confirmation

When an interactive installation reaches a desired effective asset identity whose destination is occupied but not covered by machine-local ownership, the system SHALL disclose the destination and ask whether to continue before adopting or replacing it. Continue SHALL be the default. Equivalent content SHALL be adopted without rewriting it; divergent content SHALL be replaced only after continuation. Cancellation SHALL roll back every prior mutation in the operation. Non-interactive callers SHALL continue automatically, preserving the existing reconciliation behavior.

The confirmation SHALL remain separate from MCP declaration consent and MCP configuration takeover. Supplying MCP approval SHALL NOT approve an asset takeover. Receipt-owned destinations SHALL reconcile without a takeover confirmation, and destinations outside the desired set SHALL NOT be inspected merely to search for takeovers.

#### Scenario: Interactive user continues an untracked takeover

- **WHEN** a desired asset reaches an occupied untracked destination and the user continues
- **THEN** the system SHALL reconcile the destination and record ownership only after successful commit

#### Scenario: Equivalent content is adopted without writing

- **WHEN** the untracked destination already contains the desired rendered asset
- **THEN** the system SHALL leave its bytes unchanged and record it as reconciled after success

#### Scenario: Divergent content is replaced after continuation

- **WHEN** the untracked destination differs and the user continues
- **THEN** the system SHALL replace it transactionally with the desired asset

#### Scenario: Cancellation restores the complete operation

- **WHEN** the user cancels at an asset takeover after earlier asset mutations
- **THEN** the system SHALL restore every prior mutation and commit no project-state change

#### Scenario: Non-interactive takeover preserves existing behavior

- **WHEN** a non-interactive install reaches an occupied untracked asset destination
- **THEN** the system SHALL continue reconciliation without opening a prompt or requiring MCP approval

#### Scenario: Owned destination does not prompt

- **WHEN** machine-local ownership already covers the desired effective asset identity
- **THEN** the system SHALL reconcile it without a takeover confirmation

## MODIFIED Requirements

### Requirement: Asset methods are the only interface for asset storage

The system SHALL perform every primary text-asset and skill-companion storage operation through the selected adapter's install, read, and delete operations. It SHALL NOT directly inspect or modify adapter asset directories. The adapter SHALL own its tool's asset storage format, roots, path resolution, metadata conventions, and skill-bundle lifecycle. Archive-only supplementary files SHALL never be passed to an adapter. Keyed entries inside shared tool-owned project configuration SHALL use their dedicated capability rather than masquerading as text assets or passing through asset methods.

The tagged request/result shapes of the asset install, read, and delete operations SHALL be implemented by adapter APIs `0.1` and `0.2`. A consumer SHALL NOT invoke them on an adapter declaring the superseded positional API `0.0`.

#### Scenario: System delegates primary and companion installation

- **WHEN** a skill primary and companions must be installed for an adapter
- **THEN** the system SHALL submit one skill installation request
- **AND** it SHALL NOT write any requested file directly into the adapter tree

#### Scenario: Archive-only supplementary file is withheld

- **WHEN** a verified archive includes root `README.md`
- **THEN** the system SHALL NOT include that file in any adapter request

#### Scenario: MCP configuration is not an asset request

- **WHEN** a facet contributes an MCP server declaration
- **THEN** the system SHALL NOT represent it as a skill, agent, or command or pass it to asset storage methods
