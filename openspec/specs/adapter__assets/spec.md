## Purpose

Each adapter is a full abstraction layer over its AI coding tool's storage. The system never decides where an asset lives or how it is encoded — an adapter answers both. An adapter decides what should change and states it as exact per-file transitions; the system performs every write. This lets each adapter own its tool's directory structure, file format, front-matter conventions, and metadata handling, while every write in the system is subject to one set of guarantees about concurrency, atomicity, and restoration.
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

### Requirement: Adapters plan asset installation without mutating anything

An adapter SHALL accept an installation planning request whose content shape is determined by asset type. Every planning request SHALL identify the project it targets, its scope, and its asset name. The project SHALL be supplied on every request regardless of scope; an adapter SHALL NOT derive it from the process working directory, so a caller installing into a project it is not running inside resolves the same destinations as one that is. A skill request SHALL carry the primary `SKILL.md` text, per-asset metadata, a canonical map from companion paths relative to the skill root to opaque bytes, and the caller-verified set of previously-owned companion paths; an empty companion map and an empty previously-owned set SHALL each be valid. Adapters SHALL NOT persist ownership metadata or infer ownership from disk contents. Each request SHALL carry both, from separate sources: the content to write comes from the caller's verified resolved state, while the previously-owned paths a write may remove come exclusively from the caller's machine-local record of what it materialized. An adapter SHALL treat the supplied owned set as the complete extent of what it may remove, and SHALL NOT widen it by convention, by filename pattern, or by any legacy storage format. Agent and command requests SHALL each carry one text content value and per-asset metadata and SHALL NOT carry companions or ownership sets. No installation request SHALL represent archive-only supplementary files.

The adapter SHALL own path resolution, containment, storage format, metadata assembly, and deciding which owned files are obsolete. It SHALL NOT write, delete, or create anything: planning SHALL leave every inspected file byte-for-byte unchanged, including its modification time.

A plan SHALL report either that the asset already matches its desired state, or the complete set of file changes that would realize it. Each planned change SHALL name an absolute path, the exact state that path was observed in, and — for a write — the exact bytes to commit. Each planned change SHALL also carry the directory it is authorized to work inside; every planned path SHALL be strictly below it. A file already holding its desired bytes SHALL contribute no change, so re-planning an unchanged asset yields no work at all.

Skill installation SHALL plan the complete owned bundle as one set of changes: the new primary, the new companions, and the removal of previously-owned companion paths absent from the new request. Removal SHALL be limited to the supplied previously-owned set. Companion bytes SHALL be stored verbatim; metadata or front-matter transformation SHALL apply only to the primary file. Unowned files SHALL NOT be removed.

Before any filesystem access, every supplied companion path — new or previously owned — SHALL be validated as relative, canonical, and confined below the resolved skill root; a request containing a malformed or escaping path SHALL be rejected without reading anything. Expected failures SHALL be returned as structured results.

#### Scenario: Install a skill with companions

- **WHEN** a skill request contains primary content and companions `references/api.md` and `assets/logo.png`
- **THEN** the plan SHALL contain a write for the primary and for both companions below that skill's storage location
- **AND** planned companion bytes SHALL be byte-identical to the request
- **AND** primary metadata SHALL NOT be inserted into companion files

#### Scenario: Planning writes nothing

- **WHEN** an adapter plans any installation
- **THEN** no file SHALL be created, modified, or removed
- **AND** no inspected file's modification time SHALL change

#### Scenario: An unchanged asset plans no change

- **WHEN** the destination already holds exactly the bytes the request would write
- **THEN** the plan SHALL report the asset as already matching
- **AND** the plan SHALL contain no file change

#### Scenario: A planned change states what it was computed from

- **WHEN** a plan contains a write to an occupied destination
- **THEN** that change SHALL carry the exact state the destination was observed in

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

#### Scenario: A refused bundle change leaves no partial bundle

- **WHEN** any part of a planned skill bundle cannot be committed
- **THEN** the operation SHALL report structured failure data
- **AND** the complete prior bundle SHALL remain intact

#### Scenario: Escaping companion path is rejected

- **WHEN** a skill request contains an absolute companion path or a path that escapes the skill root — in the new bundle or in the previously-owned set
- **THEN** the adapter SHALL reject the request without reading, writing, or deleting any file

#### Scenario: Agent and command contain one primary value

- **WHEN** an agent or command is installed
- **THEN** its request SHALL contain exactly one primary text value and no companion map

### Requirement: Adapters report what a destination already holds

A plan SHALL report whether the destination was absent, already equivalent to the desired asset, or occupied by something that differs. An adapter that cannot prove equivalence SHALL report a difference; unprovable equality SHALL fail safe. Equivalence SHALL be decided on the adapter's own storage semantics, so a document whose meaning is unchanged but whose formatting or key order differs MAY be reported as equivalent and left untouched.

The adapter SHALL NOT enumerate an asset directory to discover what it owns. Ownership arrives on every request, and the supplied set SHALL be the complete extent of what may be inspected as owned or removed.

#### Scenario: An occupied destination is distinguished from an absent one

- **WHEN** a plan targets a destination that already contains a file
- **THEN** the plan SHALL report the destination as occupied rather than absent

#### Scenario: Unprovable equality is reported as a difference

- **WHEN** an adapter cannot prove that existing content is equivalent to the desired asset
- **THEN** the plan SHALL report a difference

#### Scenario: A directory is never enumerated to discover ownership

- **WHEN** a skill directory contains an unowned `notes.txt` absent from the request's owned path set
- **THEN** no plan SHALL read, change, or remove `notes.txt`

### Requirement: Adapters plan asset removal without mutating anything

An adapter SHALL accept a type-specific removal planning request at a given scope. Every removal request SHALL identify the project it targets, its scope, asset type, and asset name. A skill removal request SHALL additionally carry the caller-verified owned companion path set.

A removal plan SHALL report either that nothing is there, or the complete set of file removals that takes the asset away: the primary plus exactly the supplied owned companion paths. Each planned removal SHALL name an absolute path and the exact state that path was observed in. Every other file SHALL be preserved. Directories left empty by removing owned files SHALL be pruned, bounded by the adapter's authorized directory and never removing it.

A skill whose primary file is already gone SHALL still have its owned companions planned for removal: each has an exact observed state of its own, so removing them remains reversible.

Before any filesystem access, every supplied owned path SHALL be validated as relative, canonical, and confined below the resolved skill root; a request containing a malformed or escaping path SHALL be rejected without reading anything.

#### Scenario: Remove an existing multi-file skill

- **WHEN** removal targets a skill and the request supplies its two owned companion paths
- **THEN** the plan SHALL contain a removal for the primary and for both supplied owned files

#### Scenario: A bundle whose primary is gone still removes its owned companions

- **WHEN** a skill's primary file is already absent and its owned companions are present
- **THEN** the plan SHALL contain a removal for each present owned companion

#### Scenario: Removing an absent asset plans nothing

- **WHEN** the requested asset does not exist at that scope
- **THEN** the plan SHALL report that nothing is there
- **AND** the plan SHALL contain no file change

#### Scenario: Escaping owned path is rejected before deletion

- **WHEN** a deletion request's owned path set contains `../outside.md` or an absolute path
- **THEN** the adapter SHALL reject the request as structured failure data
- **AND** SHALL delete nothing

#### Scenario: Skill deletion preserves unowned file

- **WHEN** the skill directory contains `notes.txt` that is not recorded as owned
- **THEN** skill deletion SHALL leave `notes.txt` unchanged
- **AND** SHALL leave any directory needed to contain it

#### Scenario: A refused removal restores the prior bundle

- **WHEN** a planned removal cannot be completed after one owned file has already been removed
- **THEN** the operation SHALL report structured failure data
- **AND** every removed file SHALL be restored to its exact prior bytes

### Requirement: Adapter planning is the only interface for asset storage decisions

The system SHALL decide every primary text-asset and skill-companion storage question through the selected adapter's planning operations. It SHALL NOT choose asset paths, storage encodings, or metadata conventions itself, and SHALL NOT inspect adapter asset directories to discover what is there. The adapter SHALL own its tool's asset storage format, roots, path resolution, metadata conventions, and skill-bundle composition. Archive-only supplementary files SHALL never be passed to an adapter. Keyed entries inside shared tool-owned project configuration SHALL use their dedicated capability rather than masquerading as text assets.

An adapter SHALL declare whether it materializes assets at all. An adapter that declares no asset capability SHALL still validate manifest metadata and SHALL NOT be offered as an installation target.

#### Scenario: System delegates primary and companion planning

- **WHEN** a skill primary and companions must be installed for an adapter
- **THEN** the system SHALL submit one skill planning request
- **AND** it SHALL NOT choose any file path itself

#### Scenario: Archive-only supplementary file is withheld

- **WHEN** a verified archive includes root `README.md`
- **THEN** the system SHALL NOT include that file in any adapter request

#### Scenario: MCP configuration is not an asset request

- **WHEN** a facet contributes an MCP server declaration
- **THEN** the system SHALL NOT represent it as a skill, agent, or command or pass it to asset storage methods

### Requirement: Untracked occupied asset destinations require just-in-time confirmation

When an interactive installation reaches a desired effective asset identity whose destination is occupied but not covered by machine-local ownership, the system SHALL disclose the destination and ask whether to continue before adopting or replacing it. Continue SHALL be the default. Equivalent content SHALL be adopted without rewriting it; divergent content SHALL be replaced only after continuation. Cancellation SHALL restore every file the operation already changed to its exact prior bytes. Non-interactive callers SHALL continue automatically, preserving the existing reconciliation behavior.

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
