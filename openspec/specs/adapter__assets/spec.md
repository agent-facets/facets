## Purpose

Each adapter is a full abstraction layer over its AI coding tool's storage. The system never reads or writes asset files directly — all asset operations go through the adapter's install, read, and delete methods. This lets each adapter own its tool's directory structure, file format, frontmatter conventions, and metadata handling, and lets the system remain tool-agnostic.
## Requirements
### Requirement: Adapters build per-asset metadata with validation and defaults

An adapter SHALL accept raw per-asset metadata from a facet manifest, validate it, apply adapter-specific defaults, and return the enriched metadata object. The result SHALL be a discriminated type: either success with the enriched metadata or failure with structured errors. Each error SHALL include the path to the invalid field, a human-readable message, what was expected, and what was actually found.

#### Scenario: Metadata builds successfully

- **WHEN** an adapter builds metadata from input that conforms to its schema
- **THEN** the result SHALL indicate success
- **AND** the result SHALL include the enriched metadata object with any adapter-specific defaults applied

#### Scenario: Metadata build fails validation

- **WHEN** an adapter builds metadata from input that does not conform to its schema
- **THEN** the result SHALL indicate failure
- **AND** the result SHALL include one or more errors, each with a field path, message, expected value, and actual value

#### Scenario: Adapter applies default values

- **WHEN** an adapter builds metadata from input that omits optional fields
- **THEN** the enriched metadata SHALL include the adapter's default values for those fields

### Requirement: Adapters provide asset installation

An adapter SHALL accept an installation request whose content shape is determined by asset type. Every installation request SHALL identify its scope and asset name. A skill request SHALL carry the primary `SKILL.md` text, per-asset metadata, a canonical map from companion paths relative to the skill root to opaque bytes, and the caller-verified set of previously-owned companion paths; an empty companion map and an empty previously-owned set SHALL each be valid. Adapters SHALL NOT persist ownership metadata or infer ownership from disk contents. Each request SHALL carry both, from separate sources: the content to write comes from the caller's verified resolved state, while the previously-owned paths a write may remove come exclusively from the caller's machine-local record of what it materialized. An adapter SHALL treat the supplied owned set as the complete extent of what it may remove, and SHALL NOT widen it by convention, by filename pattern, or by any legacy storage format. Agent and command requests SHALL each carry one text content value and per-asset metadata and SHALL NOT carry companions or ownership sets. No installation request SHALL represent archive-only supplementary files.

The adapter SHALL own path resolution, containment, directory creation, metadata assembly, storage format, and rollback. Before any filesystem access, every supplied companion path — new or previously owned — SHALL be validated as relative, canonical, and confined below the resolved skill root; a request containing a malformed or escaping path SHALL be rejected without reading, writing, or deleting anything. Skill installation SHALL replace the complete owned bundle atomically: the new primary and companions SHALL all commit, with previously-owned companion paths absent from the new request removed, or the prior bundle SHALL remain intact. Removal during replacement SHALL be limited to the supplied previously-owned set. Companion bytes SHALL be stored verbatim; metadata or front-matter transformation SHALL apply only to the primary file. Unowned files SHALL NOT be removed. Expected failures SHALL be returned as structured results. Atomicity SHALL cover handled failures within one operation; recovery from an interrupted operation is the caller's idempotent re-install, so installation SHALL remain idempotent and convergent.

#### Scenario: Install a skill with companions

- **WHEN** a skill request contains primary content and companions `references/api.md` and `assets/logo.png`
- **THEN** the adapter SHALL store the primary and both companions below that skill's storage location
- **AND** companion bytes SHALL be byte-identical to the request
- **AND** primary metadata SHALL NOT be inserted into companion files

#### Scenario: Install a skill with no companions

- **WHEN** a skill request contains an empty companion map
- **THEN** the adapter SHALL install the primary as a valid companion-less skill

#### Scenario: Install an asset at user scope

- **WHEN** installation requests user scope
- **THEN** the adapter SHALL use its user-level storage root

#### Scenario: Reinstall replaces the owned skill bundle

- **WHEN** an existing skill is reinstalled with one previously owned companion omitted from the new bundle but present in the request's previously-owned set
- **THEN** the adapter SHALL replace the primary and current companions
- **AND** remove the omitted owned companion
- **AND** preserve every file not named in the previously-owned set

#### Scenario: Failed skill installation leaves no partial bundle

- **WHEN** writing, deleting, or committing any part of a skill bundle fails
- **THEN** the adapter SHALL return structured failure data
- **AND** the complete prior bundle SHALL remain intact

#### Scenario: Escaping companion path is rejected

- **WHEN** a skill request contains an absolute companion path or a path that escapes the skill root — in the new bundle or in the previously-owned set
- **THEN** the adapter SHALL reject the request without reading, writing, or deleting any file

#### Scenario: Agent and command contain one primary value

- **WHEN** an agent or command is installed
- **THEN** its request SHALL contain exactly one primary text value and no companion map

### Requirement: Adapters provide asset reading

An adapter SHALL accept a type-specific read request at a given scope. Every read request SHALL identify its scope, asset type, and asset name. A skill read request SHALL additionally carry the caller-verified owned companion path set; reading a skill SHALL return canonical logical primary content, stored metadata, and the bytes of exactly the requested owned companion paths. The adapter SHALL NOT enumerate the skill directory to discover companions, so unowned files can never be swept into a read result. Every requested companion path SHALL be validated as relative, canonical, and confined below the skill root before any filesystem access. Reading an agent or command SHALL return canonical logical primary content and metadata without companions. Canonical primary content SHALL exclude adapter-specific storage encoding so callers can compare it with portable integrity records.

#### Scenario: Read an existing multi-file skill

- **WHEN** the system reads an installed skill supplying its two owned companion paths
- **THEN** the adapter SHALL return canonical primary content, metadata, and both requested companion byte values

#### Scenario: Read returns only requested owned companions

- **WHEN** a skill directory contains an unowned `notes.txt` absent from the request's owned path set
- **THEN** the read result SHALL NOT include `notes.txt`

#### Scenario: Read transformed primary content canonically

- **WHEN** an adapter stores front matter or other adapter-specific encoding around a primary asset
- **THEN** its read result SHALL return the canonical logical content without that encoding

#### Scenario: Read a non-existent asset

- **WHEN** the requested asset does not exist at that scope
- **THEN** the adapter SHALL return a structured not-found result

### Requirement: Adapters provide asset deletion

An adapter SHALL accept a type-specific deletion request at a given scope. Every deletion request SHALL identify its scope, asset type, and asset name. A skill deletion request SHALL additionally carry the caller-verified owned companion path set; deleting a skill SHALL remove its primary file and exactly the supplied owned companion paths as one atomic operation, SHALL preserve every other file, and SHALL prune only directories left empty by owned-file removal. Before any filesystem access, every supplied owned path SHALL be validated as relative, canonical, and confined below the resolved skill root; a request containing a malformed or escaping path SHALL be rejected without deleting anything. Deleting an agent or command SHALL remove its single primary asset. Expected deletion failures and missing assets SHALL be returned as structured results.

#### Scenario: Delete an existing multi-file skill

- **WHEN** deletion targets a skill and the request supplies its two owned companion paths
- **THEN** the adapter SHALL remove the primary and both supplied owned files as one operation

#### Scenario: Escaping owned path is rejected before deletion

- **WHEN** a deletion request's owned path set contains `../outside.md` or an absolute path
- **THEN** the adapter SHALL reject the request as structured failure data
- **AND** SHALL delete nothing

#### Scenario: Skill deletion preserves unowned file

- **WHEN** the skill directory contains `notes.txt` that is not recorded as owned
- **THEN** skill deletion SHALL leave `notes.txt` unchanged
- **AND** SHALL leave any directory needed to contain it

#### Scenario: Failed deletion restores the prior bundle

- **WHEN** deletion fails after one owned file has been staged for removal
- **THEN** the adapter SHALL return structured failure data
- **AND** the prior complete bundle SHALL remain available

#### Scenario: Delete a non-existent asset

- **WHEN** the requested asset does not exist at that scope
- **THEN** the adapter SHALL return a structured not-found result

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
